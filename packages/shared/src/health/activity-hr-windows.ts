import { activityLogWindow } from '../running/heart-health'
import type { HrWindow } from './zone-minutes'

/**
 * Issue 3775 item 3 (owner, 16 Nov 2026). The workout and activity windows an all-day heart-rate
 * series is read against: inside one, a gap between readings counts up to 5½ minutes toward zone
 * and heart-health minutes; outside, up to 2 (`creditedGapSec` in `zone-minutes.ts`).
 *
 * The ONE place a day's windows are built, so the Activity score's zone minutes and the zone trends
 * agree on what was a workout. Reads the generic shapes only (connector guide §3d): a strength
 * session's start and finish, and an activity log's local date and clock times placed by
 * `activityLogWindow`, the rule the heart-health activity already uses. A session still in progress
 * (no finish) or a log with no start time gives no window: its time keeps the 2-minute cap rather
 * than a guessed span.
 */
export function activityHrWindows(
  input: {
    sessions?: readonly { startedAt: string | Date; completedAt?: string | Date | null }[]
    activityLogs?: readonly {
      date: string
      startTime?: string | null
      endTime?: string | null
      durationMin?: number | null
    }[]
  },
  tz: string,
): HrWindow[] {
  const out: HrWindow[] = []
  for (const s of input.sessions ?? []) {
    if (s.completedAt == null) continue
    const fromMs = new Date(s.startedAt).getTime()
    const toMs = new Date(s.completedAt).getTime()
    if (Number.isFinite(fromMs) && Number.isFinite(toMs) && toMs > fromMs) out.push({ fromMs, toMs })
  }
  for (const log of input.activityLogs ?? []) {
    const w = activityLogWindow(log, tz)
    if (w) out.push({ fromMs: w.from.getTime(), toMs: w.to.getTime() })
  }
  return out.sort((a, b) => a.fromMs - b.fromMs)
}
