import { describe, it, expect } from 'vitest'
import {
  activityLogWindow, completedAsForActivity, heartHealthDayOutcome, heartHealthRescore, heartHealthVerdict,
  zone2PlusMinutes, type HeartHealthActivity,
} from '../heart-health'

const act = (over: Partial<HeartHealthActivity>): HeartHealthActivity => ({
  id: 'a', title: 'Treadmill walk', activityType: 'treadmill', durationMin: 34, zone2PlusMin: 0, ...over,
})

describe('issue 2093 — zone 2+ minutes', () => {
  it('sums zones 2 to 5 and leaves zone 1 out', () => {
    // 10 min zone 1, 20 min zone 2, 5 min zone 3, 1 min zone 5
    expect(zone2PlusMinutes([600, 1200, 300, 0, 60])).toBe(26)
    expect(zone2PlusMinutes([3600, 0, 0, 0, 0])).toBe(0)
  })
})

describe('issue 2093 — the verdict: any activity, by its zone 2+ minutes', () => {
  it('a brisk treadmill walk counts', () => {
    const v = heartHealthVerdict(30, [act({ id: 'tw', zone2PlusMin: 31 })])
    expect(v).toMatchObject({ targetMin: 30, countedMin: 31, met: true })
    expect(v.credited?.id).toBe('tw')
  })

  it('a slow stroll does not, however long it was', () => {
    const v = heartHealthVerdict(30, [act({ title: 'Evening stroll', activityType: 'walk', durationMin: 41, zone2PlusMin: 6 })])
    expect(v).toMatchObject({ countedMin: 6, met: false })
  })

  it('a run counts only for the minutes it spent in zone 2 or above', () => {
    expect(heartHealthVerdict(30, [act({ activityType: 'run', durationMin: 35, zone2PlusMin: 24 })]).met).toBe(false)
  })

  it('adds every activity on the day, and credits the one with the most minutes', () => {
    const v = heartHealthVerdict(30, [
      act({ id: 'walk', zone2PlusMin: 12 }),
      act({ id: 'ride', activityType: 'cycling', zone2PlusMin: 20 }),
    ])
    expect(v).toMatchObject({ countedMin: 32, met: true })
    expect(v.credited?.id).toBe('ride')
  })

  it('an activity with no heart rate counts nothing and is never credited', () => {
    const v = heartHealthVerdict(30, [act({ zone2PlusMin: null, durationMin: 45 })])
    expect(v).toMatchObject({ countedMin: 0, met: false, credited: null })
  })

  it('a prescription with no minutes cannot be met', () => {
    expect(heartHealthVerdict(null, [act({ zone2PlusMin: 50 })]).met).toBe(false)
    expect(heartHealthVerdict(0, [act({ zone2PlusMin: 50 })]).met).toBe(false)
  })
})

describe('issue 2093 — how a history row reads', () => {
  const met = heartHealthVerdict(30, [act({ zone2PlusMin: 31 })])
  const short = heartHealthVerdict(30, [act({ zone2PlusMin: 6 })])
  it('counted, not counted, nothing logged, or today', () => {
    expect(heartHealthDayOutcome(met, 1, false, 'pending')).toBe('counted')
    expect(heartHealthDayOutcome(short, 1, false, 'pending')).toBe('not-counted')
    expect(heartHealthDayOutcome(heartHealthVerdict(30, []), 0, false, 'pending')).toBe('nothing-logged')
    expect(heartHealthDayOutcome(short, 1, true, 'pending')).toBe('today')
  })
  it('a recorded completion reads as counted, so the history never contradicts the card', () => {
    expect(heartHealthDayOutcome(short, 1, false, 'completed')).toBe('counted')
  })
})

describe('issue 2093 — re-scoring a stored row', () => {
  const met = heartHealthVerdict(30, [act({ id: 'log-1', zone2PlusMin: 31 })])
  it('completes a pending day that met the rule, linked to the credited activity', () => {
    expect(heartHealthRescore({ status: 'pending' }, met)).toEqual({ action: 'complete', activityLogId: 'log-1', completedAs: 'walk' })
  })
  it('never takes a completion back, and never overrules a skip', () => {
    const short = heartHealthVerdict(30, [act({ zone2PlusMin: 3 })])
    expect(heartHealthRescore({ status: 'completed' }, short)).toEqual({ action: 'none' })
    expect(heartHealthRescore({ status: 'skipped' }, met)).toEqual({ action: 'none' })
    expect(heartHealthRescore({ status: 'pending' }, short)).toEqual({ action: 'none' })
  })
  it('records a run as a run and anything else as not a run (LB-179)', () => {
    expect(completedAsForActivity('run')).toBe('run')
    for (const t of ['walk', 'treadmill', 'cycling', null]) expect(completedAsForActivity(t)).toBe('walk')
    const run = heartHealthVerdict(30, [act({ id: 'r', activityType: 'run', zone2PlusMin: 33 })])
    expect(heartHealthRescore({ status: 'pending' }, run)).toMatchObject({ completedAs: 'run' })
  })
})

describe('issue 2093 — placing an activity against the heart-rate series', () => {
  const TZ = 'Australia/Brisbane' // UTC+10, no DST
  it('uses the local clock times', () => {
    const w = activityLogWindow({ date: '2026-10-06', startTime: '07:15:00', endTime: '07:49' }, TZ)
    expect(w?.from.toISOString()).toBe('2026-10-05T21:15:00.000Z')
    expect(w?.to.toISOString()).toBe('2026-10-05T21:49:00.000Z')
  })
  it('falls back to the duration when there is no end time', () => {
    const w = activityLogWindow({ date: '2026-10-06', startTime: '18:00', durationMin: 41 }, TZ)
    expect(w?.to.toISOString()).toBe('2026-10-06T08:41:00.000Z')
  })
  it('crosses midnight onto the next local day', () => {
    const w = activityLogWindow({ date: '2026-10-06', startTime: '23:40', endTime: '00:20' }, TZ)
    expect(w?.to.toISOString()).toBe('2026-10-06T14:20:00.000Z')
  })
  it('is unknown without a start time, or without any end', () => {
    expect(activityLogWindow({ date: '2026-10-06', durationMin: 30 }, TZ)).toBeNull()
    expect(activityLogWindow({ date: '2026-10-06', startTime: '07:00' }, TZ)).toBeNull()
  })
})
