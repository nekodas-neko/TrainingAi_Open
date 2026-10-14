// Keeps Oura's webhook subscriptions alive (#2859): runs `ensureOuraWebhookSubscriptions` five minutes
// after boot and every 12 hours after that, in production. Subscriptions are app-level, so one pass covers every user.
//
// It does nothing unless every webhook setting is present and this is production: a dev server or a
// test never reaches Oura from here. Across replicas, a session-level advisory lock lets one pass run
// at a time, so two replicas booting together cannot both create the same subscription.
//
// **Session-level, not transaction-scoped.** A pass makes up to 22 Oura calls. A transaction held open
// across them is killed by the pool's `idle_in_transaction_session_timeout` (15 s, `client.ts`), which
// drops the lock mid-pass (a second replica can then create duplicates) and leaves an `error` on a
// client nobody listens to, which Node raises as an uncaught exception. So: no BEGIN, the lock is
// taken on the connection, released in `finally`, and the client carries an `error` listener for as
// long as it is held. If the connection dies, Postgres drops the lock with it.
import type { Pool } from 'pg'
import { getPool } from '@/lib/data/postgres/client'
import { ouraOAuthConfig } from './config'
import { ensureOuraWebhookSubscriptions, type SubscriptionReport } from './subscriptions'
import { reportOuraCloudIssue } from './report'
import { ouraWebhookConfig } from './webhook'

export const RENEWAL_INTERVAL_MS = 12 * 60 * 60 * 1000
/**
 * The first pass waits this long after boot. Creating a subscription makes Oura call the callback to
 * verify it, and right after a deploy the traffic may still reach the previous container, which (on
 * the first release with this route) has no webhook to answer.
 */
export const FIRST_PASS_DELAY_MS = 5 * 60 * 1000
const LOCK_KEY = 'oura-webhook-renewal'

export interface RenewalDeps {
  pool: Pick<Pool, 'connect'>
  ensure: typeof ensureOuraWebhookSubscriptions
}

/** One pass under the lock. `null` when another replica holds it or the settings are missing. */
export async function runOuraWebhookRenewal(
  dryRun = false, deps?: RenewalDeps,
): Promise<SubscriptionReport | null> {
  const config = ouraWebhookConfig(ouraOAuthConfig())
  if (!config) return null
  const { pool, ensure } = deps ?? { pool: getPool(), ensure: ensureOuraWebhookSubscriptions }
  const client = await pool.connect()
  // A dropped connection while held must not become an uncaught exception; the pass's own next
  // query fails instead, and the client is discarded below.
  let broken: Error | undefined
  const onError = (err: Error) => {
    broken = err
    console.error('[oura] webhook renewal: database connection error:', err.message)
  }
  client.on('error', onError)
  let locked = false
  try {
    const { rows } = await client.query<{ locked: boolean }>('SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS locked', [LOCK_KEY])
    locked = rows[0]?.locked === true
    if (!locked) return null
    return await ensure(config, { dryRun })
  } finally {
    if (locked && !broken) {
      await client.query('SELECT pg_advisory_unlock(hashtextextended($1, 0))', [LOCK_KEY]).catch((err: Error) => { broken = err })
    }
    client.removeListener('error', onError)
    // A client whose unlock failed may still hold the lock; destroy it rather than hand it back to
    // the pool, so the lock goes with the connection instead of blocking every later pass.
    client.release(broken)
  }
}

/**
 * One timer tick: runs a pass and records what went wrong (rate limited, `report.ts`). Never throws:
 * the next tick tries again either way.
 */
export function renewalPass(run: () => Promise<SubscriptionReport | null> = runOuraWebhookRenewal): Promise<void> {
  return run()
    .then(report => {
      if (report && report.failed.length > 0) {
        const detail = `${report.failed.length} subscription(s) failed: ${report.failed.map(f => `${f.subscription} (${f.status ?? 'no answer'})`).join(', ')}`
        console.warn(`[oura] webhook renewal: ${detail}`)
        reportOuraCloudIssue('webhook-renewal:failed', detail)
      }
    })
    .catch(err => {
      const message = err instanceof Error ? err.message : 'unknown'
      console.error('[oura] webhook renewal failed:', message)
      reportOuraCloudIssue('webhook-renewal:error', message)
    })
}

let timer: ReturnType<typeof setTimeout> | null = null

/** Starts the 12-hour renewal in this process. Production only; idempotent. */
export function startOuraWebhookRenewal(env: NodeJS.ProcessEnv = process.env): boolean {
  if (timer || env.NODE_ENV !== 'production' || !ouraWebhookConfig(ouraOAuthConfig(env), env)) return false
  const pass = () => { void renewalPass() }
  timer = setTimeout(() => {
    pass()
    setInterval(pass, RENEWAL_INTERVAL_MS).unref?.()
  }, FIRST_PASS_DELAY_MS)
  timer.unref?.()
  return true
}
