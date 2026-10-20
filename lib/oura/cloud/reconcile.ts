// The daily reconciliation read (#3079): re-reads the last `RECONCILE_DAYS` days of every document
// type and the heart-rate series for each connected user, through the same code as the connect
// backfill (`backfillOuraCloud`).
//
// Webhooks are the primary feed, but Oura retries a failed delivery only about ten times over an
// hour, so a missed event used to be recovered only by a manual backfill. Oura also revises a night
// after it first arrives, and heart rate lands in batches. This catches all three, and a workout
// deleted in the Oura app whose delete event was missed: one gone from a day it re-read is
// tombstoned (#3087). Every upsert is
// idempotent, so a day that did not change writes the same rows and re-scores nothing
// (`rescore-nights.ts` acts only on a night whose fingerprint changed).
//
// Scheduled like the webhook renewal (`renewal.ts`): in-process, production only, under a
// session-level advisory lock so two replicas never run a pass at once. The first pass waits
// `FIRST_PASS_DELAY_MS` after boot, then one every `RECONCILE_INTERVAL_MS`. A release restarts the
// clock, so the read also runs shortly after every deploy.
import type { Pool } from 'pg'
import { getPool } from '@/lib/data/postgres/client'
import type { WorkoutRepository } from '@/lib/data/repository'
import { DEFAULT_TZ, shiftDateStr, toAestDay } from '@trainingai/shared/date-utils'
import { backfillOuraCloud, type OuraBackfillResult } from './backfill'
import { ouraOAuthConfig, type OuraOAuthConfig } from './config'
import { reportOuraCloudIssue } from './report'
import { withSessionLock } from './renewal'

/** Today and the two days before it: last night, and the nights Oura is still likely to revise. */
export const RECONCILE_DAYS = 3
export const RECONCILE_INTERVAL_MS = 24 * 60 * 60 * 1000
/** Clear of the renewal's first pass (5 min) and of a deploy's first minutes of traffic. */
export const FIRST_PASS_DELAY_MS = 20 * 60 * 1000
const LOCK_KEY = 'oura-daily-reconcile'

export interface ReconcileUserOutcome {
  userId: string
  from: string
  to: string
  result: 'ok' | 'stopped_early' | 'not_connected' | 'reauth' | 'invalid_range' | 'error'
}

export interface ReconcileDeps {
  repo: WorkoutRepository
  config: OuraOAuthConfig
  /** Replaceable for tests. */
  backfill?: typeof backfillOuraCloud
  now?: () => Date
}

function outcomeOf(result: OuraBackfillResult): ReconcileUserOutcome['result'] {
  if (!result.ok) return result.error
  return result.report.stoppedEarly ? 'stopped_early' : 'ok'
}

/**
 * One pass over every connected user, one at a time: each user is about a dozen Oura requests and a
 * few hundred upserts, and the pool is deliberately small. One user's failure never stops the next.
 */
export async function reconcileOuraCloud(deps: ReconcileDeps): Promise<ReconcileUserOutcome[]> {
  const backfill = deps.backfill ?? backfillOuraCloud
  const now = deps.now?.() ?? new Date()
  const out: ReconcileUserOutcome[] = []
  for (const userId of await deps.repo.listOuraCloudConnectedUserIds()) {
    const user = await deps.repo.getUserById(userId).catch(() => null)
    const tz = user?.timezone ?? DEFAULT_TZ
    const to = toAestDay(now, tz)
    const from = shiftDateStr(to, -(RECONCILE_DAYS - 1))
    try {
      const result = await backfill({ repo: deps.repo, config: deps.config, rescore: deps.repo }, userId, {
        from, to, dryRun: false, heartRate: true, tz, tombstoneAbsentWorkouts: true,
      })
      const outcome = outcomeOf(result)
      out.push({ userId, from, to, result: outcome })
      if (outcome !== 'ok') {
        const detail = result.ok ? result.report.stoppedEarly ?? outcome : outcome
        console.warn(`[oura] daily reconciliation ${from}..${to}: ${detail}`)
        reportOuraCloudIssue(`reconcile:${outcome}`, detail, { userId })
      }
    } catch (err) {
      out.push({ userId, from, to, result: 'error' })
      const message = err instanceof Error ? err.message : 'unknown'
      console.error('[oura] daily reconciliation failed:', message)
      reportOuraCloudIssue('reconcile:error', message, { userId })
    }
  }
  return out
}

/** One pass under the lock. `null` when another replica holds it or Oura is not configured. */
export async function runOuraReconcile(
  deps?: { pool: Pick<Pool, 'connect'>; reconcile: ReconcileDeps },
): Promise<ReconcileUserOutcome[] | null> {
  let resolved = deps
  if (!resolved) {
    const config = ouraOAuthConfig()
    if (!config) return null
    const { getRepositoryAsync } = await import('@/lib/data')
    resolved = { pool: getPool(), reconcile: { repo: await getRepositoryAsync(), config } }
  }
  const { reconcile } = resolved
  return withSessionLock(resolved.pool, LOCK_KEY, () => reconcileOuraCloud(reconcile), 'daily reconciliation')
}

/** One timer tick. Never throws: the next tick tries again either way. */
export function reconcilePass(run: () => Promise<ReconcileUserOutcome[] | null> = () => runOuraReconcile()): Promise<void> {
  return run()
    .then(outcomes => {
      if (outcomes) console.info(`[oura] daily reconciliation: ${outcomes.filter(o => o.result === 'ok').length} of ${outcomes.length} user(s) read`)
    })
    .catch(err => {
      const message = err instanceof Error ? err.message : 'unknown'
      console.error('[oura] daily reconciliation pass failed:', message)
      reportOuraCloudIssue('reconcile:error', message)
    })
}

let timer: ReturnType<typeof setTimeout> | null = null

/** Starts the daily reconciliation in this process. Production only, with Oura configured; idempotent. */
export function startOuraReconcile(env: NodeJS.ProcessEnv = process.env): boolean {
  if (timer || env.NODE_ENV !== 'production' || !ouraOAuthConfig(env)) return false
  const pass = () => { void reconcilePass() }
  timer = setTimeout(() => {
    pass()
    setInterval(pass, RECONCILE_INTERVAL_MS).unref?.()
  }, FIRST_PASS_DELAY_MS)
  timer.unref?.()
  return true
}
