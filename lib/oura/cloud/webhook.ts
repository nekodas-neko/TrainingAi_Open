// Oura's webhook (#2859): the verification challenge, the signature check, and what one event does.
//
// From the pinned spec (`tags` → "Webhook Subscription Routes"):
//   - Verification: `GET <callback>?verification_token=…&challenge=…`, answered `{ "challenge": … }`
//     when the token is ours, 401 otherwise.
//   - Events: `POST <callback>` with `x-oura-signature` (HMAC-SHA256 of `x-oura-timestamp` followed by
//     the JSON body, keyed with the app's client secret, upper-case hex) and a small body naming the
//     document: `{ event_type, data_type, object_id, event_time, user_id }`.
//   - Answer within 10 s. Oura retries a failed delivery about ten times over an hour, and a 410
//     CANCELS the subscription, so this module never asks the route for a 410.
//
// The route is public and unauthenticated, so everything here fails closed: no settings, no
// signature, a stale timestamp or a body that is not the spec's shape is refused before any lookup.
import { createHmac, timingSafeEqual } from 'node:crypto'
import { z } from 'zod'
import { safeCompare } from '@/lib/security/constant-time'
import type { OuraOAuthConfig } from './config'
import { OuraUnavailableError } from './client'
import type { WorkoutRepository } from '@/lib/data/repository'
import { DEFAULT_TZ } from '@trainingai/shared/date-utils'
import { fetchOuraDocument, fetchOuraHeartRate, OuraForbiddenError, OuraUnauthorizedError } from './data'
import { isOuraTypeShared, mapHeartRateRows, mapOuraDocuments, OURA_DELETE_TYPES, OURA_DOCUMENT_TYPES, type OuraDocumentType } from './documents'
import { reportOuraCloudIssue } from './report'
import { reattributeAfterHeartRate, writeOuraCloudData, type OuraCloudWriteCounts, type OuraCloudWriter, type OuraWorkoutHrReattribute } from './ingest'
import { withNightRescore, type NightRescoreRepo } from '@/lib/health/rescore-nights'
import { confirmOuraTokenRefused, getOuraAccessToken, getOuraGrantedScopes, OuraReauthRequiredError, type OuraRefusalVerdict, type OuraTokenStore } from './tokens'

/** The webhook settings, from the environment. `null` when any is missing: the route answers 503. */
export interface OuraWebhookConfig {
  oauth: OuraOAuthConfig
  /** `OURA_WEBHOOK_CALLBACK_URL`: where Oura posts, registered with each subscription. */
  callbackUrl: string
  /** `OURA_WEBHOOK_VERIFICATION_TOKEN`: what Oura echoes back on the verification GET. */
  verificationToken: string
}

export function ouraWebhookConfig(oauth: OuraOAuthConfig | null, env: NodeJS.ProcessEnv = process.env): OuraWebhookConfig | null {
  const callbackUrl = env.OURA_WEBHOOK_CALLBACK_URL?.trim()
  const verificationToken = env.OURA_WEBHOOK_VERIFICATION_TOKEN?.trim()
  if (!oauth || !callbackUrl || !verificationToken) return null
  try {
    const { protocol } = new URL(callbackUrl)
    if (protocol !== 'https:' && protocol !== 'http:') return null
  } catch {
    return null
  }
  return { oauth, callbackUrl, verificationToken }
}

/** True when the verification GET carries our token. Constant-time. */
export function isOurVerificationToken(config: OuraWebhookConfig, token: string): boolean {
  return safeCompare(token, config.verificationToken)
}

/**
 * How far an event's `x-oura-timestamp` may sit from now. The past bound covers Oura's hour of
 * retries with room to spare; the future bound is clock skew. A replay inside the window can only
 * make us re-read a document we are allowed to read, and the write is idempotent.
 */
export const MAX_EVENT_AGE_MS = 2 * 60 * 60 * 1000
export const MAX_EVENT_SKEW_MS = 5 * 60 * 1000

/** Seconds or milliseconds since the epoch, as a number of ms; `null` when it is not one. */
function timestampMs(raw: string): number | null {
  if (!/^\d{9,14}$/.test(raw)) return null
  const n = Number(raw)
  return n < 1e12 ? n * 1000 : n
}

function hmacHex(secret: string, message: string): string {
  return createHmac('sha256', secret).update(message, 'utf8').digest('hex').toUpperCase()
}

function sameHex(a: string, b: string): boolean {
  const bufA = Buffer.from(a)
  const bufB = Buffer.from(b)
  if (bufA.length !== bufB.length) return false
  return timingSafeEqual(bufA, bufB)
}

export type SignatureVerdict = 'ok' | 'missing' | 'stale' | 'mismatch'

/**
 * Checks an event's signature over the body exactly as received. The spec's sample signs
 * `timestamp + JSON.stringify(body)` of the parsed body, which equals the raw text whenever Oura sends
 * compact JSON; the re-serialised form is also accepted so a whitespace difference does not drop a
 * genuine event. Both need the client secret, so accepting either does not widen who can sign.
 */
export function verifyOuraSignature(
  secret: string, signature: string | null, timestamp: string | null, rawBody: string, now = Date.now(),
): SignatureVerdict {
  if (!signature || !timestamp) return 'missing'
  const at = timestampMs(timestamp.trim())
  if (at == null || at < now - MAX_EVENT_AGE_MS || at > now + MAX_EVENT_SKEW_MS) return 'stale'
  const given = signature.trim().replace(/^sha256=/i, '').toUpperCase()
  if (!/^[0-9A-F]{64}$/.test(given)) return 'mismatch'
  if (sameHex(given, hmacHex(secret, timestamp.trim() + rawBody))) return 'ok'
  let reserialised: string | null = null
  try { reserialised = JSON.stringify(JSON.parse(rawBody)) } catch { /* not JSON: no second form */ }
  if (reserialised !== null && reserialised !== rawBody && sameHex(given, hmacHex(secret, timestamp.trim() + reserialised))) return 'ok'
  return 'mismatch'
}

/** The event body, per the spec's description. Unknown members are ignored, not refused. */
export const OuraWebhookEvent = z.object({
  event_type: z.enum(['create', 'update', 'delete']),
  data_type: z.string().min(1).max(64),
  object_id: z.string().min(1).max(256),
  user_id: z.string().min(1).max(256),
  event_time: z.string().max(64).optional(),
})
export type OuraWebhookEvent = z.infer<typeof OuraWebhookEvent>

export type OuraWebhookOutcome =
  /** The document was read and written. */
  | { result: 'written'; counts: OuraCloudWriteCounts }
  /** A delete was applied: a sleep period or workout tombstoned (0 when we held none). */
  | { result: 'deleted'; rows: number }
  /** Nothing to do: a data type we do not store, or a delete of a type we keep no tombstone for. */
  | { result: 'ignored'; reason: string }
  /** Nobody here is connected to that Oura account (any more), or their connection cannot be used. */
  | { result: 'unknown_user' }
  /** Oura no longer has the document, or it did not match the spec. */
  | { result: 'not_found' }
  /** The connection needs the user to connect again; retrying will not help. */
  | { result: 'reauth' }
  /** Oura refused this data type for the user (membership or consent). */
  | { result: 'forbidden' }

export type OuraWebhookDeps = {
  repo: OuraCloudWriter & OuraTokenStore & OuraHeartRateReader & { getUserIdByOuraUserId(ouraUserId: string): Promise<string | null> }
  config: OuraOAuthConfig
  /** Starts the heart-rate catch-up for a user; replaceable for tests. Default: `startOuraCloudHeartRateCatchUp`. */
  heartRate?: (userId: string) => void
  /** #3079: re-scores a recent night a sleep event changed or deleted (`rescore-nights.ts`). */
  rescore?: NightRescoreRepo
  /**
   * #3078: re-attributes completed workouts whose window the heart-rate catch-up just changed
   * (`workoutHrReattributor`). Without it the catch-up writes heart rate and nothing else.
   */
  workoutHr?: OuraWorkoutHrReattribute
}

function isStoredType(t: string): t is OuraDocumentType {
  return Object.prototype.hasOwnProperty.call(OURA_DOCUMENT_TYPES, t)
}

/**
 * Handles one verified event. Throws only the client's `OuraUnavailableError` (and database errors): those are
 * worth Oura's retry, so the route answers 503 for them. Every other outcome is final and answered 200.
 */
export async function handleOuraWebhookEvent(deps: OuraWebhookDeps, event: OuraWebhookEvent): Promise<OuraWebhookOutcome> {
  if (!isStoredType(event.data_type)) return { result: 'ignored', reason: `data_type ${event.data_type} is not stored` }
  const userId = await deps.repo.getUserIdByOuraUserId(event.user_id)
  if (!userId) return { result: 'unknown_user' }

  if (event.event_type === 'delete') {
    if (!OURA_DELETE_TYPES.includes(event.data_type)) return { result: 'ignored', reason: `delete of ${event.data_type} is not tracked` }
    // #3087: a workout deleted in the Oura app stops counting in the energy budget. Kept and marked.
    if (event.data_type === 'workout') return { result: 'deleted', rows: await deps.repo.tombstoneOuraWorkouts(userId, [event.object_id]) }
    const rows = await withNightRescore(deps.rescore, userId, async () => {
      const n = await deps.repo.tombstoneOuraCloudSleep(userId, [event.object_id])
      // #3080: the day's HRV and resting HR follow its main period, which may have been this one.
      await deps.repo.syncOuraMainSleepBodyMetrics(userId, { days: [], ouraIds: [event.object_id] })
      return n
    })
    return { result: 'deleted', rows }
  }

  // Oura answers 401 for a type the user did not share, which would read as `reauth` (#2974).
  const granted = await getOuraGrantedScopes(deps.repo, userId)
  if (!isOuraTypeShared(granted, event.data_type)) return { result: 'ignored', reason: `${event.data_type} is not shared` }

  let token: string | null = null
  try {
    token = await getOuraAccessToken(deps.repo, deps.config, userId)
    if (!token) return { result: 'unknown_user' }
    const doc = await fetchOuraDocument(token, event.data_type, event.object_id)
    if (!doc) return { result: 'not_found' }
    const counts = await writeOuraCloudData(deps.repo, userId, mapOuraDocuments([doc]), deps.rescore)
    if (HEART_RATE_TRIGGERS.has(event.data_type)) {
      if (isOuraTypeShared(granted, 'heartrate')) (deps.heartRate ?? (u => startOuraCloudHeartRateCatchUp(deps, u)))(userId)
      // The user's choice on Oura's consent page, not a failure: logged, never reported (as the backfill does).
      else console.info('[oura] heart-rate catch-up skipped: the user did not share heart rate')
    }
    return { result: 'written', counts }
  } catch (err) {
    if (err instanceof OuraReauthRequiredError) return { result: 'reauth' }
    if (err instanceof OuraUnauthorizedError && token) return afterRefusal(await confirmOuraTokenRefused(deps.repo, deps.config, userId, token))
    if (err instanceof OuraForbiddenError) return { result: 'forbidden' }
    throw err
  }
}

/**
 * #3204: a 401 on a type the grant covers, once `confirmOuraTokenRefused` has said what it meant. A
 * fresh token stored now is worth Oura's retry, which reads the document with it.
 */
function afterRefusal(verdict: OuraRefusalVerdict): OuraWebhookOutcome {
  if (verdict === 'type_refused') return { result: 'forbidden' }
  if (verdict === 'refreshed') throw new OuraUnavailableError('Oura refused an access token that a refresh has replaced; retry')
  return { result: 'reauth' }
}

/** True for a failure worth Oura's retry (Oura unreachable, slow or rate limiting us); the route answers 503. */
export function isRetryableOuraError(err: unknown): boolean {
  return err instanceof OuraUnavailableError
}

// ── Heart rate ────────────────────────────────────────────────────────────────────────────────
//
// Oura has no heart-rate webhook (spec `ExtApiV2DataType`), so without this `oura_heartrate` would
// stop at the connect backfill. A sleep, daily activity or workout event means the ring has synced,
// so each one also reads the series from the newest `oura_cloud` point to now. It runs after the
// answer, never inside it: Oura wants the event answered within 10 s and a heart-rate read is
// another request set. Each read starts `HEART_RATE_OVERLAP_MS` behind that point (#3078). One sync fans out into several of these events, so a user's catch-up runs
// at most once per `HEART_RATE_MIN_INTERVAL_MS` in this process.

/** The events that start a heart-rate catch-up. */
export const HEART_RATE_TRIGGERS: ReadonlySet<string> = new Set(['sleep', 'daily_activity', 'workout'])
/** The furthest back one catch-up reads; the connect backfill and the agent job cover older gaps. */
export const HEART_RATE_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000
export const HEART_RATE_MIN_INTERVAL_MS = 5 * 60 * 1000
/**
 * A catch-up over at least this long that Oura answers with no heart rate is reported (#2982). A
 * shorter one can be empty for real: the user's previous sync landed minutes ago.
 */
export const HEART_RATE_EMPTY_REPORT_MS = 60 * 60 * 1000
/**
 * How far behind the newest stored `oura_cloud` point each catch-up starts (#3078). Oura uploads in
 * batches, often hours late, and a batch can carry points stamped earlier than one already stored
 * (an awake burst lands after the sleep that followed it); a read starting at the newest point skips
 * those for good. Re-reading the overlap costs one larger page and the upsert is idempotent.
 */
export const HEART_RATE_OVERLAP_MS = 6 * 60 * 60 * 1000

export type OuraHeartRateReader = Pick<WorkoutRepository, 'getLatestOuraCloudHeartrateAt' | 'getUserById'>

/**
 * Reads the user's heart rate from `HEART_RATE_OVERLAP_MS` behind the newest stored `oura_cloud` point
 * (at most a week back) to now, and writes it through `upsertOuraCloudHeartrate` with the user's
 * timezone. When points were new or changed, the completed workouts they overlap are re-attributed
 * (`deps.workoutHr`, #3078); a failure there is reported and does not fail the read. Returns points
 * written (offered after the device-row cover filter), or `null` when the user has no usable connection.
 *
 * A read that lands nothing is reported, never silent (#2982: no Oura heart rate had landed and
 * nothing said why): an empty answer over an hour or more, rows that failed the spec's shape, and
 * rows that were read but none written. Reports carry counts and durations, never a reading.
 */
export async function catchUpOuraCloudHeartRate(
  deps: Pick<OuraWebhookDeps, 'repo' | 'config' | 'workoutHr'>, userId: string, now = Date.now(),
): Promise<number | null> {
  const token = await getOuraAccessToken(deps.repo, deps.config, userId)
  if (!token) return null
  const floor = new Date(now - HEART_RATE_LOOKBACK_MS)
  const newest = await deps.repo.getLatestOuraCloudHeartrateAt(userId, floor)
  const user = await deps.repo.getUserById(userId)
  const tz = user?.timezone ?? DEFAULT_TZ
  // An overlap behind the newest point, never past the floor: re-reading stored points is an
  // idempotent upsert, and a start at (or after) the newest point drops a batch Oura stamped earlier.
  const from = newest ? new Date(Math.max(floor.getTime(), newest.getTime() - HEART_RATE_OVERLAP_MS)) : floor
  let got: Awaited<ReturnType<typeof fetchOuraHeartRate>>
  try {
    got = await fetchOuraHeartRate(token, from, new Date(now))
  } catch (err) {
    // #3204: a dead grant is recorded. The read stays refused either way; the next event reads again.
    // A check that fails is reported on its own, and the refusal is still what this read ends in.
    if (err instanceof OuraUnauthorizedError) {
      await confirmOuraTokenRefused(deps.repo, deps.config, userId, token).catch((checkErr: unknown) =>
        reportOuraCloudIssue('webhook-heartrate:refusal-check', checkErr instanceof Error ? checkErr.message : 'unknown', { userId }))
    }
    throw err
  }
  const points = mapHeartRateRows(got.rows)
  const write = points.length === 0
    ? { offered: 0, changed: 0, changedFrom: null, changedTo: null }
    : await deps.repo.upsertOuraCloudHeartrate(userId, points, tz)
  const written = write.offered
  await reattributeAfterHeartRate(deps.workoutHr, userId, write, tz, 'webhook-heartrate:workouts')
  // The span with nothing stored yet: what an empty answer says Oura is missing.
  const unseenFrom = newest ?? floor
  const hours = Math.round((now - unseenFrom.getTime()) / 3_600_000)
  // Every read says what happened to it, so a partial loss to the device-row cover filter (plausible
  // points not written) shows in the logs too, not only a total one.
  console.info(`[oura] heart-rate catch-up from ${from.toISOString()}: ${got.rows.length} read, ${points.length} plausible, ${written} written (${write.changed} new or changed), ${points.length - written} covered by device rows`)
  if (got.dropped > 0) {
    reportOuraCloudIssue('webhook-heartrate:dropped', `${got.dropped} of ${got.rows.length + got.dropped} rows did not match the spec`, { userId })
  }
  if (got.rows.length === 0 && got.dropped === 0 && now - unseenFrom.getTime() >= HEART_RATE_EMPTY_REPORT_MS) {
    reportOuraCloudIssue('webhook-heartrate:empty', `Oura answered no heart rate for the last ${hours} h (${newest ? 'after a stored point' : 'none stored this week'})`, { userId })
  } else if (got.rows.length > 0 && written === 0) {
    reportOuraCloudIssue('webhook-heartrate:none-written', `${got.rows.length} rows read, ${points.length} plausible, 0 written (all covered by device rows or implausible)`, { userId })
  }
  return written
}

const heartRateLastRun = new Map<string, number>()

/** Starts `catchUpOuraCloudHeartRate` in the background, throttled per user. Never throws. */
export function startOuraCloudHeartRateCatchUp(deps: Pick<OuraWebhookDeps, 'repo' | 'config' | 'workoutHr'>, userId: string, now = Date.now()): void {
  const last = heartRateLastRun.get(userId)
  if (last !== undefined && now - last < HEART_RATE_MIN_INTERVAL_MS) return
  heartRateLastRun.set(userId, now)
  catchUpOuraCloudHeartRate(deps, userId, now).catch(err => {
    // A refusal is final for this read, but it is why no heart rate lands, so it is reported (#2982).
    const refused = err instanceof OuraUnauthorizedError ? 'Oura answered 401'
      : err instanceof OuraForbiddenError ? 'Oura answered 403'
      : err instanceof OuraReauthRequiredError ? 'the connection needs the user to connect again'
      : null
    if (refused) {
      console.warn(`[oura] heart-rate catch-up refused: ${refused}`)
      reportOuraCloudIssue('webhook-heartrate:refused', `the heart-rate read was refused: ${refused}`, { userId })
      return
    }
    const message = err instanceof Error ? err.message : 'unknown'
    console.warn(`[oura] heart-rate catch-up failed: ${message}`)
    reportOuraCloudIssue('webhook-heartrate:failed', message, { userId })
  })
}

/** Test seam: forget the per-user throttle. */
export function resetOuraCloudHeartRateThrottle(): void {
  heartRateLastRun.clear()
}
