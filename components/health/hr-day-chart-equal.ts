import type { HrSleepWindow } from '@trainingai/shared/health/hr-sleep-band'
import type { StressBucket } from '@/components/body-battery/stress-day'

export interface HrDayReading {
  timestamp: string
  bpm: number
  source: string | null
}

export interface HrDayWorkoutSession {
  sessionName: string
  startedAt: string
  completedAt: string | null
}

export interface HrDayChartProps {
  readings: HrDayReading[]
  date: string  // YYYY-MM-DD in user's tz
  workoutSessions?: HrDayWorkoutSession[]
  compact?: boolean
  showLegend?: boolean
  lineColor?: string
  sleepWindow?: HrSleepWindow | null  // primary sleep interval (minutes-of-day); overrides the source heuristic
  /**
   * TN-3b — the day's stress buckets, drawn against the same clock as the heart rate so the
   * owner can read one against the other. Omitted by callers that do not fetch it; an empty
   * array draws nothing rather than an empty axis.
   */
  stressSeries?: StressBucket[]
  /** The zone the buckets are placed in. Required with `stressSeries`; device-local would
   *  put a Brisbane morning in the afternoon on a travelling phone. */
  stressTimezone?: string
  bucketMinutes?: number  // bucket width for smoothing; larger = smoother/less granular line
  showBackfill?: boolean  // opt-in: draw a dashed, clearly-labeled estimated line across real coverage gaps
}

function sameReadings(a: HrDayReading[], b: HrDayReading[]): boolean {
  if (a === b) return true
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i += 1) {
    if (a[i].timestamp !== b[i].timestamp || a[i].bpm !== b[i].bpm || a[i].source !== b[i].source) return false
  }
  return true
}

function sameSessions(a: HrDayWorkoutSession[] | undefined, b: HrDayWorkoutSession[] | undefined): boolean {
  if (a === b) return true
  if (a == null || b == null) return false
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i += 1) {
    if (a[i].sessionName !== b[i].sessionName || a[i].startedAt !== b[i].startedAt || a[i].completedAt !== b[i].completedAt) return false
  }
  return true
}

function sameStress(a: StressBucket[] | undefined, b: StressBucket[] | undefined): boolean {
  if (a === b) return true
  if (a == null || b == null) return false
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i += 1) {
    if (a[i].t !== b[i].t || a[i].level !== b[i].level) return false
  }
  return true
}

function sameSleep(a: HrSleepWindow | null | undefined, b: HrSleepWindow | null | undefined): boolean {
  if (a === b) return true
  if (a == null || b == null) return false
  return a.startMin === b.startMin && a.endMin === b.endMin
}

/**
 * Should `HrDayChart` skip a re-render? (OR-162, the mechanism behind DV-12.)
 *
 * **This is a by-value comparator because the props arrive as fresh arrays with identical
 * contents.** Both call sites refetch on the tab-switch epoch and hand the result straight to
 * `setState`, so every tab tap gives the chart a new `readings` array holding the same day. The
 * default shallow `React.memo` compares identity and therefore never skips anything; chart.js then
 * re-measures its axis labels, which is the canvas `font` writes device sweep 4a counted — 30 per
 * switch on Home and 80 on Health, **while the panel is hidden**, so none of that work can be seen.
 *
 * The full walk is deliberate rather than a sampled or length-only check: a comparator that returns
 * `true` too eagerly does not crash, it leaves yesterday's line on screen, and that is invisible
 * until someone notices the numbers are old. A day of readings is a few thousand primitive
 * comparisons against tens of milliseconds of label measurement, so the cheap version buys nothing
 * and risks the silent failure.
 */
export function hrDayChartPropsEqual(a: HrDayChartProps, b: HrDayChartProps): boolean {
  if (
    a.date !== b.date ||
    a.compact !== b.compact ||
    a.showLegend !== b.showLegend ||
    a.lineColor !== b.lineColor ||
    a.bucketMinutes !== b.bucketMinutes ||
    a.showBackfill !== b.showBackfill ||
    a.stressTimezone !== b.stressTimezone
  ) return false
  if (!sameSleep(a.sleepWindow, b.sleepWindow)) return false
  if (!sameSessions(a.workoutSessions, b.workoutSessions)) return false
  if (!sameStress(a.stressSeries, b.stressSeries)) return false
  return sameReadings(a.readings, b.readings)
}
