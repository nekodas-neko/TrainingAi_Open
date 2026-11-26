/**
 * Body Battery replay (#3925 item 2): run the app's own `computeBodyBatteryDay` over recorded
 * inputs, so a finished day can be recomputed away from the database that holds it.
 *
 * The harness used to bundle `walkBodyBattery` and mirror the route's constants by hand, which
 * left it on v7 when v8 added the exercise drain, v9 keyed the baselines by the source's
 * algorithm version, and 18 Nov moved readiness (the anchor) to centre on 75. Anything that copies
 * part of the day falls behind the same way, so this module copies nothing: it records what each
 * repository read returned while the real function ran, and replays the function on those answers.
 *
 *  - `recordingRepository(repo)` wraps a real repository. It answers only the reads
 *    `computeBodyBatteryDay` makes and throws on every other method, writes included, so a capture
 *    can never change the database it reads.
 *  - `replayRepository(recording)` answers the same reads from the recording and throws on a read
 *    it never saw, so a model change that reads something new fails loudly instead of replaying
 *    a different day.
 *  - `finishedBodyBatteryDay` is THE recompute of a finished day (midnight to midnight, frozen
 *    anchor kept). `rederiveBodyBattery` calls it, and so will the storage fix #3925 item 1 asks for.
 *  - `endValueChangeBands` turns stored-versus-recomputed pairs into the count the owner signs off
 *    on: how many days move, and by how much in bands, with no health value in it.
 */
import type { WorkoutRepository, BodyBatteryDailyRow } from '@/lib/data/repository'
import { shiftDateStr, dateStrMidnightInTz } from '@trainingai/shared/date-utils'
import { computeBodyBatteryDay, type BodyBatteryDay } from '@/lib/health/body-battery-day'
import { safeErrorText } from '@/lib/observability/scrub-params'

/** Every read `computeBodyBatteryDay` makes when `computeReadinessIfMissing` is false. */
export const BODY_BATTERY_DAY_READS = [
  'getOuraDaily',
  'getOuraDailyDerived',
  'listBodyMetrics',
  'listSleepSessions',
  'getHrForWindow',
  'getUserById',
  'getOuraDaytimeSignals',
  'getBodyBatteryHistory',
  'getOuraCloudSwitchDay',
  'getWorkoutSessionsFrom',
  'getUserGoals',
  'listActivityLogs',
  'getDaytimeHrvModel',
] as const
type ReadName = (typeof BODY_BATTERY_DAY_READS)[number]
const READS = new Set<string>(BODY_BATTERY_DAY_READS)

/** One recorded read: its arguments as a key, and what it returned or that it threw. */
export interface RecordedCall {
  key: string
  result?: unknown
  threw?: string
}
export interface ReplayRecording {
  /** `BODY_BATTERY_MODEL_VERSION` the inputs were recorded under, for the reader's information. */
  modelVersion?: string
  userId: string
  tz: string
  calls: RecordedCall[]
}

/** A Date survives JSON as `{ $date: iso }`, so a recording read back gives the same values. */
export function serialiseRecording(recording: ReplayRecording): string {
  return JSON.stringify(recording, function (this: Record<string, unknown>, k, v) {
    const raw = this[k]
    return raw instanceof Date ? { $date: raw.toISOString() } : v
  })
}
export function parseRecording(text: string): ReplayRecording {
  return JSON.parse(text, (_k, v) =>
    v && typeof v === 'object' && !Array.isArray(v) && typeof (v as { $date?: unknown }).$date === 'string'
      && Object.keys(v).length === 1
      ? new Date((v as { $date: string }).$date)
      : v) as ReplayRecording
}

function callKey(name: string, args: unknown[]): string {
  return `${name}(${JSON.stringify(args.map(a => (a instanceof Date ? a.toISOString() : a)))})`
}

/** The user row holds far more than a battery day reads. Only these two fields are kept. */
function keepUserFields(user: unknown): unknown {
  if (user == null || typeof user !== 'object') return user
  const u = user as { dateOfBirth?: unknown; activityLevel?: unknown }
  return { dateOfBirth: u.dateOfBirth ?? null, activityLevel: u.activityLevel ?? null }
}

function refuse(name: string): never {
  throw new Error(`body-battery replay: ${name} is not a Body Battery read, and the replay repository answers nothing else`)
}

/** A read-only view of `repo` that records every Body Battery read it answers. */
export function recordingRepository(repo: WorkoutRepository, userId: string, tz: string): {
  repo: WorkoutRepository
  recording: ReplayRecording
} {
  const recording: ReplayRecording = { userId, tz, calls: [] }
  const seen = new Set<string>()
  const proxy = new Proxy({} as WorkoutRepository, {
    get(_t, prop) {
      if (typeof prop !== 'string') return undefined
      if (!READS.has(prop)) return () => refuse(prop)
      return async (...args: unknown[]) => {
        const key = callKey(prop, args)
        const fn = (repo as unknown as Record<ReadName, (...a: unknown[]) => Promise<unknown>>)[prop as ReadName]
        try {
          const raw = await fn.apply(repo, args)
          const result = prop === 'getUserById' ? keepUserFields(raw) : raw
          if (!seen.has(key)) { seen.add(key); recording.calls.push({ key, result }) }
          return result
        } catch (err) {
          if (!seen.has(key)) { seen.add(key); recording.calls.push({ key, threw: safeErrorText(err) }) }
          throw err
        }
      }
    },
  })
  return { repo: proxy, recording }
}

/** A repository that answers only from `recording`, and throws on anything it did not record. */
export function replayRepository(recording: ReplayRecording): WorkoutRepository {
  const byKey = new Map(recording.calls.map(c => [c.key, c]))
  return new Proxy({} as WorkoutRepository, {
    get(_t, prop) {
      if (typeof prop !== 'string') return undefined
      if (!READS.has(prop)) return () => refuse(prop)
      return async (...args: unknown[]) => {
        const key = callKey(prop, args)
        const hit = byKey.get(key)
        if (!hit) throw new Error(`body-battery replay: no recorded answer for ${key}`)
        if (hit.threw !== undefined) throw new Error(hit.threw)
        // A fresh copy per read, so nothing the function does to a result reaches the next replay.
        return structuredClone(hit.result)
      }
    },
  })
}

/**
 * A finished day's Body Battery under the current model: midnight to midnight, the frozen anchor
 * kept, readiness never computed on demand. The one recompute of a past day.
 */
export function finishedBodyBatteryDay(repo: WorkoutRepository, userId: string, tz: string, date: string): Promise<BodyBatteryDay> {
  return computeBodyBatteryDay({
    repo, userId, tz, date,
    until: dateStrMidnightInTz(shiftDateStr(date, 1), tz),
    computeReadinessIfMissing: false,
  })
}

/** Record every finished day in `[from, to]` from `repo`, by running the real recompute on it. */
export async function captureFinishedDays(
  repo: WorkoutRepository, userId: string, tz: string, from: string, to: string,
): Promise<{ recording: ReplayRecording; dates: string[] }> {
  const rec = recordingRepository(repo, userId, tz)
  const dates: string[] = []
  for (let d = from; d <= to; d = shiftDateStr(d, 1)) {
    dates.push(d)
    // The stored rows are read through the recorder too, so the replay can compare against them.
    await rec.repo.getBodyBatteryHistory(userId, d, d)
    try {
      await finishedBodyBatteryDay(rec.repo, userId, tz, d)
    } catch {
      // Recorded as thrown; the replay reports the day as not recomputed.
    }
  }
  return { recording: rec.recording, dates }
}

export interface ReplayedDay {
  date: string
  stored: Pick<BodyBatteryDailyRow, 'endValue' | 'totalCharged' | 'totalDrained' | 'modelVersion'> | null
  recomputed: BodyBatteryDailyRow | null
  error?: string
}

/** Replay each date of a recording through the real recompute. */
export async function replayFinishedDays(recording: ReplayRecording, dates: readonly string[]): Promise<ReplayedDay[]> {
  const repo = replayRepository(recording)
  const out: ReplayedDay[] = []
  for (const date of dates) {
    const [row] = await repo.getBodyBatteryHistory(recording.userId, date, date).catch(() => [])
    const stored = row
      ? { endValue: row.endValue, totalCharged: row.totalCharged, totalDrained: row.totalDrained, modelVersion: row.modelVersion }
      : null
    try {
      const { snapshot } = await finishedBodyBatteryDay(repo, recording.userId, recording.tz, date)
      out.push({ date, stored, recomputed: snapshot })
    } catch (err) {
      out.push({ date, stored, recomputed: null, error: safeErrorText(err) })
    }
  }
  return out
}

/** The bands a moved end-of-day value is counted in, in points of battery. */
export const END_VALUE_BANDS = [
  { label: '1-2', min: 1, max: 2 },
  { label: '3-5', min: 3, max: 5 },
  { label: '6-10', min: 6, max: 10 },
  { label: '11-20', min: 11, max: 20 },
  { label: '21+', min: 21, max: Infinity },
] as const

export interface EndValueChangeCount {
  daysExamined: number
  /** A stored row and a recompute, with the same end value. */
  unchanged: number
  /** A stored row and a recompute, with a different end value. */
  changed: number
  up: number
  down: number
  /** Changed days by how far the end value moves, |recomputed − stored|. */
  bands: Record<(typeof END_VALUE_BANDS)[number]['label'], number>
  /** Days with no stored row that a recompute would add. */
  wouldAdd: number
  /** Days the recompute could not produce (no inputs, or it threw). */
  notRecomputed: number
}

/** Counts and bands only: nothing in the result is a health value. */
export function endValueChangeBands(
  pairs: readonly { stored: number | null | undefined; recomputed: number | null | undefined }[],
): EndValueChangeCount {
  const bands = Object.fromEntries(END_VALUE_BANDS.map(b => [b.label, 0])) as EndValueChangeCount['bands']
  const count: EndValueChangeCount = {
    daysExamined: pairs.length, unchanged: 0, changed: 0, up: 0, down: 0, bands, wouldAdd: 0, notRecomputed: 0,
  }
  for (const { stored, recomputed } of pairs) {
    if (recomputed == null) { count.notRecomputed++; continue }
    if (stored == null) { count.wouldAdd++; continue }
    const delta = Math.round(recomputed) - Math.round(stored)
    if (delta === 0) { count.unchanged++; continue }
    count.changed++
    if (delta > 0) count.up++
    else count.down++
    const band = END_VALUE_BANDS.find(b => Math.abs(delta) >= b.min && Math.abs(delta) <= b.max)!
    bands[band.label]++
  }
  return count
}

/**
 * The same count from a `rederiveBodyBattery` dry-run report (the agent-key job
 * `rederive-body-battery` with `dryRun: true`, or `POST /api/admin/rederive-body-battery`): the
 * production server runs `finishedBodyBatteryDay` on production data and writes nothing.
 * A day the report could not reach (`no-row`, `before-sign-off`, `today`) is not recomputed there,
 * so it is counted as such rather than as unchanged.
 */
export function endValueChangeBandsFromReport(report: {
  days: readonly { action: string; stored?: { endValue: number }; recomputed?: { endValue: number }; error?: string }[]
}): EndValueChangeCount & { noRow: number; beforeSignOff: number; keptByWriteGuard: number } {
  const days = report.days
  const count = endValueChangeBands(days.map(d => ({
    stored: d.stored?.endValue,
    // A day the write guard keeps is not rewritten, so its stored value is what stays.
    recomputed: d.action === 'kept' ? d.stored?.endValue : d.recomputed?.endValue,
  })))
  const noRow = days.filter(d => d.action === 'no-row' && !d.error).length
  const beforeSignOff = days.filter(d => d.action === 'before-sign-off').length
  return {
    ...count,
    // Those days were never recomputed by design; only a day that failed stays not recomputed.
    notRecomputed: count.notRecomputed - noRow - beforeSignOff - days.filter(d => d.action === 'today').length,
    noRow, beforeSignOff, keptByWriteGuard: days.filter(d => d.action === 'kept').length,
  }
}
