// The history read when an Oura account connects, and the same read on demand (#2859).
//
// Oura's own advice (pinned spec, "Recommended Implementation Pattern"): one historical read when a
// user connects, then webhooks for everything after. `backfillOuraCloud` is that read over a date
// range. It writes through `ingest.ts`, so every row is `oura_cloud` and every upsert is idempotent:
// running it twice over the same days leaves the same rows. A dry run reads from Oura and reports
// what it would write, and writes nothing.
//
// It runs in two places:
//   - after a connect is stored (`tokens.ts` → `startOuraConnectBackfill`), in the background, over
//     the last `CONNECT_BACKFILL_DAYS` days;
//   - from the agent key's `oura-cloud-backfill` job, with a dry run first.
import { dateStrMidnightInTz, daysBetweenDateStrs, DEFAULT_TZ, isCalendarDate, shiftDateStr, todayInTz } from '@trainingai/shared/date-utils'
import type { WorkoutRepository } from '@/lib/data/repository'
import { fetchOuraUserId, OuraUnavailableError } from './client'
import { ouraOAuthConfig, type OuraOAuthConfig } from './config'
import { fetchOuraDocuments, fetchOuraHeartRate, OuraForbiddenError, OuraRateLimitedError, OuraUnauthorizedError } from './data'
import { isOuraTypeShared, mapHeartRateRows, mapOuraDocuments, OURA_DOCUMENT_TYPE_NAMES, type OuraDocument, type OuraDocumentType } from './documents'
import { NO_WRITES, plannedCounts, writeOuraCloudData, type OuraCloudWriteCounts, type OuraCloudWriter } from './ingest'
import { reportOuraCloudIssue } from './report'
import { getOuraAccessToken, getOuraGrantedScopes, OuraReauthRequiredError, type OuraTokenStore } from './tokens'

/** How far back a new connection reads. Inside the 180-day heart-rate retention. */
export const CONNECT_BACKFILL_DAYS = 90
/** The longest range one backfill call takes. */
export const MAX_BACKFILL_DAYS = 366
/** Documents are read 30 days a request, heart rate 7 days a request, to keep each page set small. */
const DOC_CHUNK_DAYS = 30
const HR_CHUNK_DAYS = 7
/** A 429 whose Retry-After is at most this long is waited out, up to `MAX_RATE_LIMIT_WAITS` times a run. */
export const MAX_RATE_LIMIT_WAIT_MS = 60 * 1000
export const MAX_RATE_LIMIT_WAITS = 3

export interface OuraBackfillOptions {
  /** Inclusive local days, `YYYY-MM-DD`. */
  from: string
  to: string
  dryRun: boolean
  /** Also read the heart-rate series. */
  heartRate: boolean
  /** The user's timezone: day boundaries for the heart-rate window. */
  tz: string
}

export interface OuraBackfillReport {
  dryRun: boolean
  from: string
  to: string
  /** Documents read per type. */
  documents: Partial<Record<OuraDocumentType | 'heartrate', number>>
  /** Documents that did not match the spec and were left out. */
  dropped: number
  /** Written (or, for a dry run, planned). A dry run cannot know how many sleep periods overlap. */
  counts: OuraCloudWriteCounts
  /** Types Oura refused (403: membership or consent), and why the run stopped early, if it did. */
  forbidden: string[]
  /**
   * Types the user did not share on Oura's consent page, so never asked for (#2974). Oura answers 401
   * for those, which would otherwise read as a dead token and stop the run.
   */
  notShared: string[]
  /**
   * Types the grant covers by our map that Oura still answered 401 while the token itself worked
   * (`personal_info` answered). The spec names no scope for some types, so `OURA_SCOPE_FOR` guesses;
   * an entry here means a guess is wrong.
   */
  refusedDespiteGrant: string[]
  stoppedEarly: string | null
}

export type OuraBackfillDeps = {
  repo: OuraCloudWriter & OuraTokenStore
  config: OuraOAuthConfig
  /** How a Retry-After is waited out; replaceable for tests. */
  wait?: (ms: number) => Promise<void>
}

export type OuraBackfillResult =
  | { ok: true; report: OuraBackfillReport }
  | { ok: false; error: 'not_connected' | 'reauth' | 'invalid_range' }

function chunks(from: string, to: string, size: number): [string, string][] {
  const days = daysBetweenDateStrs(from, to) + 1
  const out: [string, string][] = []
  // A day count, never a string-compared loop bound (see `shiftDateStr`).
  for (let i = 0; i < days; i += size) out.push([shiftDateStr(from, i), shiftDateStr(from, Math.min(i + size, days) - 1)])
  return out
}

/** `from` and `to` are dash-form calendar days (`normalizeDateParamIso`), in order, at most a year apart. */
export function validBackfillRange(from: string, to: string): boolean {
  if (!isCalendarDate(from) || !isCalendarDate(to) || from.includes('/') || to.includes('/')) return false
  const span = daysBetweenDateStrs(from, to)
  return Number.isFinite(span) && span >= 0 && span < MAX_BACKFILL_DAYS
}

export async function backfillOuraCloud(deps: OuraBackfillDeps, userId: string, opts: OuraBackfillOptions): Promise<OuraBackfillResult> {
  if (!validBackfillRange(opts.from, opts.to)) return { ok: false, error: 'invalid_range' }
  let token: string | null
  try {
    token = await getOuraAccessToken(deps.repo, deps.config, userId)
  } catch (err) {
    if (err instanceof OuraReauthRequiredError) return { ok: false, error: 'reauth' }
    throw err
  }
  if (!token) return { ok: false, error: 'not_connected' }
  const granted = await getOuraGrantedScopes(deps.repo, userId)

  const report: OuraBackfillReport = {
    dryRun: opts.dryRun, from: opts.from, to: opts.to, documents: {}, dropped: 0, counts: NO_WRITES, forbidden: [], notShared: [], refusedDespiteGrant: [], stoppedEarly: null,
  }
  // Oura's 429 carries a Retry-After. A short one is waited out and the same request made again; a
  // long or missing one stops the run, and the stop is reported (`startOuraConnectBackfill`).
  const wait = deps.wait ?? ((ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)))
  let waits = 0
  const withRetry = async <T>(call: () => Promise<T>): Promise<T> => {
    for (;;) {
      try {
        return await call()
      } catch (err) {
        if (!(err instanceof OuraRateLimitedError) || err.retryAfterMs == null ||
            err.retryAfterMs > MAX_RATE_LIMIT_WAIT_MS || waits >= MAX_RATE_LIMIT_WAITS) throw err
        waits++
        await wait(err.retryAfterMs)
      }
    }
  }
  const stop = (err: unknown): boolean => {
    if (err instanceof OuraUnauthorizedError) { report.stoppedEarly = 'Oura refused the access token; the user has to connect again'; return true }
    if (err instanceof OuraUnavailableError) { report.stoppedEarly = err.message; return true }
    return false
  }
  // A 401 on a type the grant covers is either a dead token or a wrong guess in `OURA_SCOPE_FOR`. One
  // `personal_info` read, which needs no scope, tells them apart; its answer holds for the rest of the run.
  let tokenAlive: Promise<boolean> | null = null
  const tokenWorks = (): Promise<boolean> => {
    tokenAlive ??= fetchOuraUserId(token).then(() => true, (err: unknown) => {
      if (err instanceof OuraUnavailableError && err.status === 401) return false
      throw err
    })
    return tokenAlive
  }
  /** After a 401 on `type`: true to skip it and carry on, false to stop (`stop` then says why). */
  const refusedTypeOnly = async (type: string): Promise<boolean> => {
    if (!(await tokenWorks())) return false
    report.refusedDespiteGrant.push(type)
    return true
  }

  // Documents: read every type, then write once, so one day's readiness, sleep and activity land as
  // one `oura_daily` row.
  const docs: OuraDocument[] = []
  read: for (const type of OURA_DOCUMENT_TYPE_NAMES) {
    if (!isOuraTypeShared(granted, type)) { report.notShared.push(type); continue }
    for (const [from, to] of chunks(opts.from, opts.to, DOC_CHUNK_DAYS)) {
      try {
        const got = await withRetry(() => fetchOuraDocuments(token, type, from, to))
        docs.push(...got.docs)
        report.documents[type] = (report.documents[type] ?? 0) + got.docs.length
        report.dropped += got.dropped
      } catch (err) {
        if (err instanceof OuraForbiddenError) { report.forbidden.push(type); continue read }
        if (err instanceof OuraUnauthorizedError) {
          try {
            if (await refusedTypeOnly(type)) continue read
          } catch (probeErr) {
            if (stop(probeErr)) break read
            throw probeErr
          }
        }
        if (stop(err)) break read
        throw err
      }
    }
  }
  const writes = mapOuraDocuments(docs)
  report.counts = opts.dryRun ? plannedCounts(writes) : await writeOuraCloudData(deps.repo, userId, writes)

  if (opts.heartRate && !report.stoppedEarly && !isOuraTypeShared(granted, 'heartrate')) report.notShared.push('heartrate')
  else if (opts.heartRate && !report.stoppedEarly) {
    for (const [from, to] of chunks(opts.from, opts.to, HR_CHUNK_DAYS)) {
      try {
        const got = await withRetry(() => fetchOuraHeartRate(token, dateStrMidnightInTz(from, opts.tz), dateStrMidnightInTz(shiftDateStr(to, 1), opts.tz)))
        const points = mapHeartRateRows(got.rows)
        report.documents.heartrate = (report.documents.heartrate ?? 0) + got.rows.length
        report.dropped += got.dropped
        const written = opts.dryRun || points.length === 0 ? points.length : await deps.repo.upsertOuraCloudHeartrate(userId, points, opts.tz)
        report.counts = { ...report.counts, heartRatePoints: report.counts.heartRatePoints + written }
      } catch (err) {
        if (err instanceof OuraForbiddenError) { report.forbidden.push('heartrate'); break }
        if (err instanceof OuraUnauthorizedError) {
          try {
            if (await refusedTypeOnly('heartrate')) break
          } catch (probeErr) {
            if (stop(probeErr)) break
            throw probeErr
          }
        }
        if (stop(err)) break
        throw err
      }
    }
  }
  return { ok: true, report }
}

// ── After a connect ───────────────────────────────────────────────────────────────────────────

const running = new Set<string>()

/**
 * Starts the connect backfill in the background and returns at once: the connect answer must not wait
 * for 90 days of history. One run per user at a time in this process; a second connect while one runs
 * does not start another. Failures are logged, never thrown: the account is connected either way, and
 * the agent job can re-run the range.
 */
export function startOuraConnectBackfill(userId: string): void {
  if (running.has(userId)) return
  const config = ouraOAuthConfig()
  if (!config) return
  running.add(userId)
  void (async () => {
    try {
      const { getRepositoryAsync } = await import('@/lib/data')
      const repo: WorkoutRepository = await getRepositoryAsync()
      const user = await repo.getUserById(userId)
      const tz = user?.timezone ?? DEFAULT_TZ
      const to = todayInTz(tz)
      const result = await backfillOuraCloud({ repo, config }, userId, {
        from: shiftDateStr(to, -(CONNECT_BACKFILL_DAYS - 1)), to, dryRun: false, heartRate: true, tz,
      })
      // A connect whose history did not arrive is otherwise invisible: the account reads connected.
      if (!result.ok) {
        console.warn(`[oura] connect backfill did not run: ${result.error}`)
        reportOuraCloudIssue(`connect-backfill:${result.error}`, 'the connect backfill did not run', { userId })
      } else if (result.report.stoppedEarly) {
        console.warn(`[oura] connect backfill stopped early: ${result.report.stoppedEarly}`)
        reportOuraCloudIssue('connect-backfill:stopped-early', result.report.stoppedEarly, { userId })
      }
      // The user's choice on Oura's consent page, not a failure: logged, never reported.
      if (result.ok && result.report.notShared.length > 0) {
        console.info(`[oura] connect backfill skipped what the user did not share with us: ${result.report.notShared.join(', ')}`)
      }
      // Our scope map is wrong for these: worth fixing, so recorded.
      if (result.ok && result.report.refusedDespiteGrant.length > 0) {
        const types = result.report.refusedDespiteGrant.join(', ')
        console.warn(`[oura] connect backfill: Oura refused ${types} although the grant covers it by our scope map`)
        reportOuraCloudIssue('connect-backfill:refused-despite-grant', `Oura refused ${types} although the grant covers it`, { userId })
      }
    } catch (err) {
      const { reportServerError } = await import('@/lib/observability')
      reportServerError(err, { userId, url: 'oura:connect-backfill' })
    } finally {
      running.delete(userId)
    }
  })()
}
