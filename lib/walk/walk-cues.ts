// Schedules one local notification per interval transition so cues fire (sound +
// vibration) even when the app is backgrounded or the screen is off — the same
// mechanism as the workout rest-timer (lib/notifications.ts). No-op off-device.
import { Capacitor } from '@capacitor/core'
import { WORKOUT_TIMERS_CHANNEL } from '@/lib/notifications'
import type { IntervalPlan, SegmentKind } from '@/lib/walk/interval-plan'

const BASE_ID = 71000 // reserve 71000..71999 for walk cues
const DONE_ID = BASE_ID + 999

function cueTitle(kind: SegmentKind): string {
  switch (kind) {
    case 'fast': return 'Fast — push the pace'
    case 'slow': return 'Slow — ease off'
    case 'cooldown': return 'Cool down'
    case 'warmup': return 'Warm up'
  }
}

export async function scheduleWalkCues(plan: IntervalPlan, startedAtMs: number): Promise<void> {
  if (!Capacitor.isNativePlatform()) return
  try {
    const { LocalNotifications } = await import('@capacitor/local-notifications')
    const now = Date.now()
    const notifications = plan.segments
      .filter(seg => startedAtMs + seg.startSec * 1000 > now + 500) // only future transitions
      .map(seg => ({
        id: BASE_ID + seg.index,
        title: cueTitle(seg.kind),
        body: `${Math.round((seg.endSec - seg.startSec) / 60)} min`,
        schedule: { at: new Date(startedAtMs + seg.startSec * 1000), allowWhileIdle: true },
        channelId: WORKOUT_TIMERS_CHANNEL,
      }))
    // A final "done" cue at the end of the plan.
    notifications.push({
      id: DONE_ID,
      title: 'Walk complete',
      body: 'Nice work.',
      schedule: { at: new Date(startedAtMs + plan.totalSec * 1000), allowWhileIdle: true },
      channelId: WORKOUT_TIMERS_CHANNEL,
    })
    if (notifications.length) await LocalNotifications.schedule({ notifications })
  } catch {
    // Nothing scheduled. There is no fallback path to name here: the in-app cue in
    // `walk-active.tsx` is driven by the segment index and runs whether or not this
    // succeeded, and it only reaches a walker with the app open. A failure here means the
    // screen-off case has no cue at all. This comment used to claim the in-app timer covered
    // it, which sent a reader looking for a path that did not exist (BF-105).
  }
}

export async function cancelWalkCues(plan: IntervalPlan): Promise<void> {
  if (!Capacitor.isNativePlatform()) return
  try {
    const { LocalNotifications } = await import('@capacitor/local-notifications')
    const ids = plan.segments.map(seg => ({ id: BASE_ID + seg.index }))
    ids.push({ id: DONE_ID })
    await LocalNotifications.cancel({ notifications: ids })
  } catch { /* nothing scheduled */ }
}
