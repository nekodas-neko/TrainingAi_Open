// The explicit "Import more history" action for Health Connect (issue 2169).
//
// Health Connect's ordinary sync keeps its 30-day cold window on purpose (the owner's 2026-09-30
// answer): a bigger automatic window would fire on every first sync and reinstall whether or not the
// user wants it. Older history comes in only when the user presses a button, 30 days at a time, each
// window older than the last, until Health Connect has nothing more or the user stops.
//
// The shape is the bounded-batch job the admin backfills use (`maxRows`, press again to continue):
// one window is the bounded batch, the account's stored oldest day is the resume point, and a window
// is idempotent, so the worst a failure costs is reading that window again.
//
// Every window goes through `syncWindow`, which posts to `/api/sync-health` - the SAME ranked-merge
// writes (`upsertBodyMetrics`, `saveSleepSession`) as a live sync, so a later live sync of an
// overlapping day merges instead of double-counting.
import { dateStrMidnightInTz, isCalendarDate, normalizeDateParamIso, shiftDateStr, todayInTz } from '@trainingai/shared/date-utils'
import { SYNC_DAYS_COLD } from '@/lib/health-connect-sync'

/** Days one window covers - one "call" of the spec. */
export const HISTORY_WINDOW_DAYS = 30
/** The furthest back an import goes. Ten years is past any Health Connect store; the bound keeps a
 *  store that answers every window with a sliver of data from walking back forever. */
export const HISTORY_MAX_DAYS = 3650
/** `/api/sync-health` allows 60 requests a minute. A dense window can use 40 of them (a daily post
 *  plus up to 20 heart-rate and 20 interval chunks), so back-to-back windows would trip a 429 on the
 *  second. One request per 1.2 s keeps a run at 50 a minute. */
export const HISTORY_REQUEST_SPACING_MS = 1_200

/** How far back an ordinary pull reaches (`getSyncDelta`'s default window). An import that stops
 *  inside it is already on the device after the ordinary pull; one that goes past it needs the
 *  restore pull (issue 2713). */
export const PULL_FLOOR_DAYS = 90
/** Slack under the run's start for a client clock behind the server's: the span is bounded by the
 *  server's `updated_at`, and a row the run wrote must not fall just below the bound. Re-applying a
 *  few extra rows is idempotent. */
export const RESTORE_SPAN_SLACK_MS = 10 * 60_000

/** True when an import reached past what the ordinary 90-day pull carries, so the imported span
 *  needs the restore pull. */
export function importNeedsRestore(oldest: string | null, today: string): boolean {
  return oldest !== null && oldest < shiftDateStr(today, -PULL_FLOOR_DAYS)
}

/** The oldest day an ordinary cold sync covers, which is where an import starts when none has run. */
export function coldSyncOldestDay(today: string): string {
  return shiftDateStr(today, -(SYNC_DAYS_COLD - 1))
}

/** The furthest-back day an import will request, and the oldest a client may claim to have reached. */
export function historyFloor(today: string): string {
  return shiftDateStr(today, -HISTORY_MAX_DAYS)
}

/** Why a client-claimed import day is not usable, or null. Shared by the progress route and the sync
 *  route's `historyFrom`, so the two cannot disagree about how far back is plausible. */
export function historyDayRejection(input: string, today: string): string | null {
  // Both separators, as every date param is (the client's localDateString() emits slashes).
  const date = normalizeDateParamIso(input)
  if (date === null || !isCalendarDate(date)) return `not a real calendar date: "${input.slice(0, 20)}"`
  if (date > today) return `dated after today (${today})`
  if (date < historyFloor(today)) return `older than ${HISTORY_MAX_DAYS} days`
  return null
}

/** The instant before which `/api/sync-health` would drop a heart-rate or interval row as stale,
 *  pushed back to cover an import's window (plus a day of slack, as the ordinary bound has). */
export function importPastToleranceStartMs(historyFrom: string, tz: string): number {
  return dateStrMidnightInTz(shiftDateStr(normalizeDateParamIso(historyFrom) ?? historyFrom, -1), tz).getTime()
}

export interface HistoryWindow {
  /** First local day of the window, inclusive. */
  fromDate: string
  /** Last local day of the window, inclusive - the day before the previous oldest. */
  toDate: string
}

export interface HistoryWindowResult {
  /** Health Connect returned nothing for the window. */
  empty: boolean
  /** The window did not fully land; do not move the cursor past it. */
  failed?: boolean
  /** POSTs the window made, for pacing against the route's rate limit. */
  requests?: number
  note?: string
}

export interface HistoryImportDeps {
  /** The user's local today. */
  today: string
  /** The oldest day imported so far, from the account; null if the action has never run. */
  oldest: string | null
  importWindow(w: HistoryWindow): Promise<HistoryWindowResult>
  /** Persist the new oldest day against the account. A throw stops the run without advancing. */
  saveOldest(date: string): Promise<void>
  shouldStop(): boolean
  onProgress?(oldest: string): void
  sleep?(ms: number): Promise<void>
  now?(): number
}

export type HistoryImportEnd =
  | 'exhausted'  // Health Connect has nothing older
  | 'limit'      // reached HISTORY_MAX_DAYS
  | 'stopped'    // the user stopped it
  | 'failed'     // a window or the save failed; press again to retry from the stored day

export interface HistoryImportOutcome {
  /** The oldest day imported after this run, null if nothing has been. */
  oldest: string | null
  /** Windows fully imported by this run. */
  windows: number
  end: HistoryImportEnd
  error?: string
}

const realSleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))

/**
 * Walk back 30 days at a time from the account's stored oldest day. A window is imported, THEN the
 * cursor is saved: a crash between the two re-reads one window, which is idempotent, where the other
 * order would silently skip it. An empty window ends the run without moving the cursor.
 */
export async function runHistoryImport(deps: HistoryImportDeps): Promise<HistoryImportOutcome> {
  const sleep = deps.sleep ?? realSleep
  const now = deps.now ?? Date.now
  const floor = historyFloor(deps.today)
  let oldest = deps.oldest ?? coldSyncOldestDay(deps.today)
  const stored = deps.oldest
  let windows = 0
  let current: string | null = stored
  const out = (end: HistoryImportEnd, error?: string): HistoryImportOutcome =>
    ({ oldest: current, windows, end, ...(error ? { error } : {}) })

  for (;;) {
    if (deps.shouldStop()) return out('stopped')
    if (oldest <= floor) return out('limit')

    const fromDate = shiftDateStr(oldest, -HISTORY_WINDOW_DAYS) < floor ? floor : shiftDateStr(oldest, -HISTORY_WINDOW_DAYS)
    const toDate = shiftDateStr(oldest, -1)
    const startedAt = now()

    let result: HistoryWindowResult
    try {
      result = await deps.importWindow({ fromDate, toDate })
    } catch (err) {
      return out('failed', err instanceof Error ? err.message : String(err))
    }
    if (result.failed) return out('failed', result.note ?? 'a window did not finish importing')
    if (result.empty) return out('exhausted')

    try {
      await deps.saveOldest(fromDate)
    } catch (err) {
      return out('failed', err instanceof Error ? err.message : String(err))
    }
    oldest = fromDate
    current = fromDate
    windows += 1
    deps.onProgress?.(fromDate)

    const wait = (result.requests ?? 0) * HISTORY_REQUEST_SPACING_MS - (now() - startedAt)
    if (wait > 0) await sleep(wait)
  }
}

/** "12 Jun" for a day this year, "12 Jun 2025" otherwise. A date-only string is formatted by its
 *  parts, never through `Date`, so no zone can shift it a day. */
export function formatImportedTo(date: string, today: string): string {
  const [y, m, d] = date.split('-').map(Number)
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  const base = `${d} ${MONTHS[m - 1]}`
  return String(y) === today.slice(0, 4) ? base : `${base} ${y}`
}

/** What the user is told when a run ends. */
export function importEndMessage(o: HistoryImportOutcome, today: string): string {
  const to = o.oldest ? formatImportedTo(o.oldest, today) : null
  switch (o.end) {
    case 'exhausted': return to ? `Imported to ${to}. Health Connect has nothing older.` : 'Health Connect has nothing older to import.'
    case 'limit': return `Imported to ${to}. That is as far back as the import goes.`
    case 'stopped': return to ? `Stopped. Imported to ${to}.` : 'Stopped.'
    case 'failed': return `Import paused${to ? ` at ${to}` : ''}: ${o.error ?? 'something went wrong'}. Press again to continue.`
  }
}

/** The account's stored oldest day, or null when the action has never run (or on a failed read). */
export async function fetchHistoryOldest(): Promise<string | null> {
  const res = await fetch('/api/health-connect/history-import', { cache: 'no-store' })
  if (!res.ok) throw new Error(`history-import ${res.status}`)
  const { oldestDate } = await res.json() as { oldestDate: string | null }
  return oldestDate
}

async function saveHistoryOldest(date: string): Promise<void> {
  const res = await fetch('/api/health-connect/history-import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ oldestDate: date }),
  })
  if (!res.ok) throw new Error(`history-import ${res.status}`)
}

/**
 * Run an import on the device: open Health Connect, read the account's resume point, walk back.
 * `null` off the native app. A platform that cannot serve Health Connect is a `failed` outcome with
 * the plugin's own note, so the screen can say why.
 */
export async function importMoreHistory(opts: {
  tz: string
  shouldStop(): boolean
  onProgress?(oldest: string): void
  /** Test seam for the pacing wait. */
  sleep?(ms: number): Promise<void>
}): Promise<HistoryImportOutcome | null> {
  const { openHealthConnect, syncWindow } = await import('@/lib/health-connect-sync')
  const opened = await openHealthConnect()
  if (!opened) return null
  const today = todayInTz(opts.tz)
  if ('note' in opened) return { oldest: null, windows: 0, end: 'failed', error: opened.note }

  const oldest = await fetchHistoryOldest()
  return runHistoryImport({
    today, oldest,
    shouldStop: opts.shouldStop,
    onProgress: opts.onProgress,
    sleep: opts.sleep,
    saveOldest: saveHistoryOldest,
    importWindow: async ({ fromDate, toDate }) => {
      // The user's own midnights, as every bucket is dated in their zone (#2438).
      const startIso = dateStrMidnightInTz(fromDate, opts.tz).toISOString()
      const endIso = dateStrMidnightInTz(shiftDateStr(toDate, 1), opts.tz).toISOString()
      const r = await syncWindow(opened, opts.tz, startIso, endIso, { historyFrom: fromDate })
      const nothing = r.metrics + r.sessions + r.sleep + r.heartRate + r.intervals === 0
      return { empty: nothing && !r.failed, failed: r.failed, requests: r.requests, note: r.note }
    },
  })
}
