// #3445: a logged activity that crosses midnight with no duration ended "the next day" by adding 24 h,
// which lands an hour out on a daylight-saving day. It ends at the same clock time on the next date.
import { describe, it, expect } from 'vitest'
import { movementWindows } from '../oura-workout-activities'
import { dateStrMidnightInTz } from '../../date-utils'

const TZ = 'Australia/Sydney'
const log = (date: string) => ({ activityLogs: [{ date, startTime: '23:30:00', endTime: '00:30:00' }], sessions: [] })
const clock = (date: string, h: number, m: number) =>
  dateStrMidnightInTz(date, TZ).getTime() + (h * 60 + m) * 60_000

describe('movementWindows across a daylight-saving change (#3445)', () => {
  it('ends a midnight-crossing log at 00:30 local on the spring-forward day', () => {
    // 2026-10-04 is 23 h long (clocks jump at 02:00); the log starts the evening before.
    const [[start, end]] = movementWindows(log('2026-10-03'), TZ)
    expect(start).toBe(clock('2026-10-03', 23, 30))
    expect(end).toBe(clock('2026-10-04', 0, 30))
  })

  it('ends a log that starts on the spring-forward day at 00:30 on the day after', () => {
    const [[, end]] = movementWindows(log('2026-10-04'), TZ)
    expect(end).toBe(dateStrMidnightInTz('2026-10-05', TZ).getTime() + 30 * 60_000)
  })

  it('keeps a window for a log that starts on the fall-back day (25 h)', () => {
    // 2027-04-04: +24 h from 23:30 lands back on 23:30, an empty window.
    const windows = movementWindows(log('2027-04-04'), TZ)
    expect(windows).toHaveLength(1)
    expect(windows[0][1]).toBe(dateStrMidnightInTz('2027-04-05', TZ).getTime() + 30 * 60_000)
  })

  it('gives no window to a log whose end is unusable and whose duration is 0', () => {
    // Used to become a bogus 24 h window; with nothing to end it on, the log covers no instants.
    for (const endTime of [null, 'soon']) {
      const counted = { activityLogs: [{ date: '2026-10-03', startTime: '23:30:00', endTime, durationMin: 0 }], sessions: [] }
      expect(movementWindows(counted, TZ)).toEqual([])
    }
  })
})
