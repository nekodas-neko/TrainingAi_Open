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
import { OuraUnavailableError } from './client'
import { ouraOAuthConfig, type OuraOAuthConfig } from './config'
import { fetchOuraDocuments, fetchOuraHeartRate, OuraForbiddenError, OuraRateLimitedError, OuraUnauthorizedError } from './data'
import { isOuraTypeShared, mapHeartRateRows, mapOuraDocuments, OURA_DOCUMENT_TYPE_NAMES, type OuraDocument, type OuraDocumentType } from './documents'
import { stampOuraData } from './freshness'
import { NO_WRITES, plannedCounts, reattributeAfterHeartRate, refreshStillRhrAfterHeartRate, writeOuraCloudData, type OuraCloudWriteCounts, type OuraCloudWriter, type OuraWorkoutHrReattribute } from './ingest'
import { stillRhrRefresher, type StillRhrRefresh } from './still-rhr'
import { reportOuraCloudIssue } from './report'
import type { NightRescoreRepo } from '@/lib/health/rescore-nights'
import { confirmOuraTokenRefused, getOuraAccessToken, getOuraGrantedScopes, OuraReauthRequiredError, type OuraRefusalVerdict, type OuraTokenStore } from './tokens'

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
  /**
   * #3087, #3153: tombstone a stored workout or session on a day whose list of that type was read
   * completely when Oura's list for that day no longer has it: the catch-up for a missed `workout`
   * or `session` delete event. The daily reconcile sets it.
   */
  tombstoneAbsent?: boolean
  /**
   * #2861: stamp `last_data_at` when documents or heart-rate points land. Default true. The daily
   * reconcile and the admin backfill pass false: they re-read days already stored, so what they
   * return is not new data from the ring and must not make a stale ring look fresh.
   */
  stampData?: boolean
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
  /** #3087: stored workouts tombstoned because Oura's list for their day no longer has them. */
  workoutsTombstoned: number
  /** #3153: stored sessions tombstoned the same way. */
  sessionsTombstoned: number
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
  /** #3079: re-scores a recent night the read changed (`rescore-nights.ts`). */
  rescore?: NightRescoreRepo
  /** #3078: re-attributes the workouts each heart-rate chunk changed (`workoutHrReattributor`). */
  workoutHr?: OuraWorkoutHrReattribute
  /** #2634: refreshes the still-period resting HR of the days each write could change (`stillRhrRefresher`). */
  stillRhr?: StillRhrRefresh
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

/** The types whose rows the reconcile tombstones when a whole read of their day no longer lists them. */
type AbsentTombstoneType = 'workout' | 'session'
const isAbsentTombstoneType = (t: OuraDocumentType): t is AbsentTombstoneType => t === 'workout' || t === 'session'

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
    dryRun: opts.dryRun, from: opts.from, to: opts.to, documents: {}, dropped: 0, counts: NO_WRITES, workoutsTombstoned: 0, sessionsTombstoned: 0, forbidden: [], notShared: [], refusedDespiteGrant: [], stoppedEarly: null,
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
  // A 401 on a type the grant covers is either a dead token or a wrong guess in `OURA_SCOPE_FOR`.
  // `confirmOuraTokenRefused` tells them apart with a `personal_info` read, which needs no scope, and
  // records a dead grant (#3204); its answer holds for the rest of the run.
  let verdict: Promise<OuraRefusalVerdict> | null = null
  const refusal = (): Promise<OuraRefusalVerdict> => {
    verdict ??= confirmOuraTokenRefused(deps.repo, deps.config, userId, token)
    return verdict
  }
  const stop = (err: unknown, why?: OuraRefusalVerdict): boolean => {
    if (err instanceof OuraUnauthorizedError) {
      // This run holds the refused token, so it stops either way; a fresh one serves the next run.
      report.stoppedEarly = why === 'refreshed'
        ? 'Oura refused the access token; a fresh one is stored for the next run'
        : 'Oura refused the access token; the user has to connect again'
      return true
    }
    if (err instanceof OuraUnavailableError) { report.stoppedEarly = err.message; return true }
    return false
  }
  /** After a 401 on `type`: true to skip it and carry on, else why to stop. */
  const refusedTypeOnly = async (type: string): Promise<true | OuraRefusalVerdict> => {
    const why = await refusal()
    if (why !== 'type_refused') return why
    report.refusedDespiteGrant.push(type)
    return true
  }

  // Documents: read every type, then write once, so one day's readiness, sleep and activity land as
  // one `oura_daily` row.
  const docs: OuraDocument[] = []
  // #3087, #3153: the workout and session chunks read whole, with the ids Oura returned for each. A
  // chunk with a dropped document is left out: the missing one may be the one that failed the spec.
  // So is one cut short by a 404: an empty or partial list would tombstone rows Oura still has.
  // Each chunk's last day is left out too: the pinned spec does not say whether `end_date` is
  // inclusive, and if it is not, that day was never read. It is checked by a later read instead (the
  // reconcile runs daily over three days, so a day reaches the middle of the window the next morning).
  const readWhole: { type: AbsentTombstoneType; from: string; to: string; keepIds: string[] }[] = []
  read: for (const type of OURA_DOCUMENT_TYPE_NAMES) {
    if (!isOuraTypeShared(granted, type)) { report.notShared.push(type); continue }
    for (const [from, to] of chunks(opts.from, opts.to, DOC_CHUNK_DAYS)) {
      try {
        const got = await withRetry(() => fetchOuraDocuments(token, type, from, to))
        docs.push(...got.docs)
        report.documents[type] = (report.documents[type] ?? 0) + got.docs.length
        report.dropped += got.dropped
        if (isAbsentTombstoneType(type) && got.complete && got.dropped === 0 && daysBetweenDateStrs(from, to) > 0) {
          readWhole.push({ type, from, to: shiftDateStr(to, -1), keepIds: got.docs.flatMap(d => d.type === type ? [d.doc.id] : []) })
        }
      } catch (err) {
        if (err instanceof OuraForbiddenError) { report.forbidden.push(type); continue read }
        if (err instanceof OuraUnauthorizedError) {
          let why: true | OuraRefusalVerdict
          try {
            why = await refusedTypeOnly(type)
          } catch (probeErr) {
            if (stop(probeErr)) break read
            throw probeErr
          }
          if (why === true) continue read
          stop(err, why)
          break read
        }
        if (stop(err)) break read
        throw err
      }
    }
  }
  const writes = mapOuraDocuments(docs)
  report.counts = opts.dryRun ? plannedCounts(writes) : await writeOuraCloudData(deps.repo, userId, writes, deps.rescore, deps.stillRhr)
  // #2861: documents that landed count as data received; an empty read does not.
  if (!opts.dryRun && opts.stampData !== false && docs.length > 0) await stampOuraData(deps.repo, userId)
  if (opts.tombstoneAbsent && !opts.dryRun) {
    for (const { type, ...range } of readWhole) {
      if (type === 'workout') report.workoutsTombstoned += await deps.repo.tombstoneOuraWorkoutsAbsent(userId, range)
      else report.sessionsTombstoned += await deps.repo.tombstoneOuraSessionsAbsent(userId, range)
    }
  }

  if (opts.heartRate && !report.stoppedEarly && !isOuraTypeShared(granted, 'heartrate')) report.notShared.push('heartrate')
  else if (opts.heartRate && !report.stoppedEarly) {
    for (const [from, to] of chunks(opts.from, opts.to, HR_CHUNK_DAYS)) {
      try {
        const got = await withRetry(() => fetchOuraHeartRate(token, dateStrMidnightInTz(from, opts.tz), dateStrMidnightInTz(shiftDateStr(to, 1), opts.tz)))
        const points = mapHeartRateRows(got.rows)
        report.documents.heartrate = (report.documents.heartrate ?? 0) + got.rows.length
        report.dropped += got.dropped
        let written = points.length
        if (!opts.dryRun && points.length > 0) {
          const write = await deps.repo.upsertOuraCloudHeartrate(userId, points, opts.tz)
          written = write.offered
          if (written > 0 && opts.stampData !== false) await stampOuraData(deps.repo, userId)
          await reattributeAfterHeartRate(deps.workoutHr, userId, write, opts.tz, 'backfill-heartrate:workouts')
          await refreshStillRhrAfterHeartRate(deps.stillRhr, userId, write, opts.tz)
        }
        report.counts = { ...report.counts, heartRatePoints: report.counts.heartRatePoints + written }
      } catch (err) {
        if (err instanceof OuraForbiddenError) { report.forbidden.push('heartrate'); break }
        if (err instanceof OuraUnauthorizedError) {
          let why: true | OuraRefusalVerdict
          try {
            why = await refusedTypeOnly('heartrate')
          } catch (probeErr) {
            if (stop(probeErr)) break
            throw probeErr
          }
          if (why !== true) stop(err, why)
          break
        }
        if (stop(err)) break
        throw err
      }
    }
  }
  return { ok: true, report }
}

// ── After a connect ───────────────────────────────────────────────────────────────────────────

/**
 * What a finished connect backfill reports besides a stop (#2982): types Oura refused with a 403,
 * documents or rows that failed the spec's shape, and a heart-rate pass that read nothing although
 * the grant covers it. Each is otherwise visible only in a report nobody reads.
 */
export function reportBackfillGaps(userId: string, report: OuraBackfillReport): void {
  if (report.forbidden.length > 0) {
    reportOuraCloudIssue('connect-backfill:forbidden', `Oura refused ${report.forbidden.join(', ')} (403)`, { userId })
  }
  if (report.dropped > 0) {
    reportOuraCloudIssue('connect-backfill:dropped', `${report.dropped} documents or rows did not match the spec`, { userId })
  }
  const heartRateSkipped = report.stoppedEarly != null || report.notShared.includes('heartrate') ||
    report.forbidden.includes('heartrate') || report.refusedDespiteGrant.includes('heartrate')
  if (!report.dryRun && !heartRateSkipped && (report.documents.heartrate ?? 0) === 0) {
    reportOuraCloudIssue('connect-backfill:heartrate-empty', `Oura answered no heart rate for ${report.from}..${report.to}`, { userId })
  }
}

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
      const { workoutHrReattributor } = await import('@/lib/workout/post-completion-hr')
      const result = await backfillOuraCloud({ repo, config, rescore: repo, workoutHr: workoutHrReattributor(repo), stillRhr: stillRhrRefresher(repo) }, userId, {
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
      if (result.ok) {
        reportBackfillGaps(userId, result.report)
        const { documents, counts } = result.report
        console.info(`[oura] connect backfill heart rate: ${documents.heartrate ?? 0} read, ${counts.heartRatePoints} written`)
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
