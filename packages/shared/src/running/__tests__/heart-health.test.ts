import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  activityLogWindow, completedAsForActivity, heartHealthDayOutcome, heartHealthFloorBpm, heartHealthMinutes,
  heartHealthRescore, heartHealthVerdict, type HeartHealthActivity,
} from '../heart-health'
import { computeHrZones, moderateIntensityBpm, MODERATE_INTENSITY_FRAC } from '../../health/hr-zones'

const act = (over: Partial<HeartHealthActivity>): HeartHealthActivity => ({
  id: 'a', title: 'Treadmill walk', activityType: 'treadmill', durationMin: 34, effortMin: 0, ...over,
})

describe('issue 2746 — a minute counts from moderate effort, 40% of reserve', () => {
  // The owner's profile as the issue states it: resting 57, max 181, reserve 124 → 57 + 0.4 × 124.
  const owner = { maxHr: 181, restingHr: 57 }
  const FLOOR = heartHealthFloorBpm(owner)
  const series = (bpms: number[]) => bpms.map((bpm, i) => ({ timestamp: i * 60_000, bpm }))

  it('is the moderate-effort line, not the zone 2 floor', () => {
    expect(FLOOR).toBe(moderateIntensityBpm(owner))
    expect(FLOOR).toBe(107)
    expect(computeHrZones(owner)[1].minBpm).toBe(131) // zone 2, the floor until 2026-10-09
  })

  it('a minute exactly at the floor counts; one just below does not', () => {
    expect(heartHealthMinutes(series([FLOOR, FLOOR]), FLOOR)).toBe(1)
    expect(heartHealthMinutes(series([FLOOR - 1, FLOOR - 1]), FLOOR)).toBe(0)
  })

  it('counts minute by minute: the brisk stretches of a walk, not its slow ones', () => {
    // 10 min at 95, 15 min at 112, 5 min at 100: only the 15 brisk minutes count.
    const walk = series([...Array(10).fill(95), ...Array(15).fill(112), ...Array(6).fill(100)])
    expect(heartHealthMinutes(walk, FLOOR)).toBe(15)
  })

  it('a gap in the data never inflates the count', () => {
    const gappy = [{ timestamp: 0, bpm: 120 }, { timestamp: 60 * 60_000, bpm: 120 }]
    expect(heartHealthMinutes(gappy, FLOOR)).toBe(2) // capped at DEFAULT_MAX_GAP_SEC
  })

  it('one reading or none measures nothing', () => {
    expect(heartHealthMinutes([], FLOOR)).toBe(0)
    expect(heartHealthMinutes(series([150]), FLOOR)).toBe(0)
  })
})

describe('issue 2746 — one floor, one source', () => {
  // The floor lives in hr-zones.ts as MODERATE_INTENSITY_FRAC. A second copy in any of the rule's
  // readers would be a second answer to "did I do it today?".
  const root = join(__dirname, '../../../../..')
  it.each([
    'packages/shared/src/running/heart-health.ts',
    'lib/health/heart-health-service.ts',
    'app/api/admin/backfill-heart-health/route.ts',
    'packages/shared/src/running/heart-health-copy.ts',
    'components/cardio/todays-cardio-card.tsx',
    'lib/activity/heart-health-completion.ts',
  ])('%s carries no zone-2 floor and no hand-written reserve fraction', (rel) => {
    const src = readFileSync(join(root, rel), 'utf8')
    expect(src).not.toMatch(/HEART_HEALTH_FLOOR_ZONE|zone2PlusMin|accumulateZoneSeconds\(|computeHrZones\(/)
    expect(src).not.toMatch(/\b0\.[46]\d*\s*\*/)
  })
  it('the rule reads its floor from moderateIntensityBpm', () => {
    const src = readFileSync(join(root, 'packages/shared/src/running/heart-health.ts'), 'utf8')
    expect(src).toMatch(/return moderateIntensityBpm\(profile\)/)
    expect(MODERATE_INTENSITY_FRAC).toBe(0.4)
  })
})

describe('issue 2093 — the verdict: any activity, by its moderate-effort minutes', () => {
  it('a brisk treadmill walk counts', () => {
    const v = heartHealthVerdict(30, [act({ id: 'tw', effortMin: 31 })])
    expect(v).toMatchObject({ targetMin: 30, countedMin: 31, met: true })
    expect(v.credited?.id).toBe('tw')
  })

  it('a slow stroll does not, however long it was', () => {
    const v = heartHealthVerdict(30, [act({ title: 'Evening stroll', activityType: 'walk', durationMin: 41, effortMin: 6 })])
    expect(v).toMatchObject({ countedMin: 6, met: false })
  })

  it('a run counts only for the minutes it spent at moderate effort or above', () => {
    expect(heartHealthVerdict(30, [act({ activityType: 'run', durationMin: 35, effortMin: 24 })]).met).toBe(false)
  })

  it('adds every activity on the day, and credits the one with the most minutes', () => {
    const v = heartHealthVerdict(30, [
      act({ id: 'walk', effortMin: 12 }),
      act({ id: 'ride', activityType: 'cycling', effortMin: 20 }),
    ])
    expect(v).toMatchObject({ countedMin: 32, met: true })
    expect(v.credited?.id).toBe('ride')
  })

  it('an activity with no heart rate counts nothing and is never credited', () => {
    const v = heartHealthVerdict(30, [act({ effortMin: null, durationMin: 45 })])
    expect(v).toMatchObject({ countedMin: 0, met: false, credited: null })
  })

  it('a prescription with no minutes cannot be met', () => {
    expect(heartHealthVerdict(null, [act({ effortMin: 50 })]).met).toBe(false)
    expect(heartHealthVerdict(0, [act({ effortMin: 50 })]).met).toBe(false)
  })
})

describe('issue 2093 — how a history row reads', () => {
  const met = heartHealthVerdict(30, [act({ effortMin: 31 })])
  const short = heartHealthVerdict(30, [act({ effortMin: 6 })])
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
  const met = heartHealthVerdict(30, [act({ id: 'log-1', effortMin: 31 })])
  it('completes a pending day that met the rule, linked to the credited activity', () => {
    expect(heartHealthRescore({ status: 'pending' }, met)).toEqual({ action: 'complete', activityLogId: 'log-1', completedAs: 'walk' })
  })
  it('never takes a completion back, and never overrules a skip', () => {
    const short = heartHealthVerdict(30, [act({ effortMin: 3 })])
    expect(heartHealthRescore({ status: 'completed' }, short)).toEqual({ action: 'none' })
    expect(heartHealthRescore({ status: 'skipped' }, met)).toEqual({ action: 'none' })
    expect(heartHealthRescore({ status: 'pending' }, short)).toEqual({ action: 'none' })
  })
  it('records a run as a run and anything else as not a run (LB-179)', () => {
    expect(completedAsForActivity('run')).toBe('run')
    for (const t of ['walk', 'treadmill', 'cycling', null]) expect(completedAsForActivity(t)).toBe('walk')
    const run = heartHealthVerdict(30, [act({ id: 'r', activityType: 'run', effortMin: 33 })])
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

describe('issue 3853 — an end equal to the start is not a 24-hour window', () => {
  const TZ = 'Australia/Brisbane' // UTC+10, no DST
  const mins = (w: ReturnType<typeof activityLogWindow>) => (w!.to.getTime() - w!.from.getTime()) / 60_000
  it('gives no window to a zero-length log with no duration', () => {
    expect(activityLogWindow({ date: '2026-07-01', startTime: '15:50', endTime: '15:50' }, TZ)).toBeNull()
    expect(activityLogWindow({ date: '2026-07-01', startTime: '15:50', endTime: '15:50', durationMin: 0 }, TZ)).toBeNull()
  })
  it('reads an end equal to the start with a duration as start + duration', () => {
    expect(mins(activityLogWindow({ date: '2026-07-01', startTime: '07:00', endTime: '07:00', durationMin: 45 }, TZ))).toBe(45)
    // The issue's 12-second treadmill log: a 12-second window, which holds fewer than two readings.
    const tiny = activityLogWindow({ date: '2026-07-01', startTime: '15:50:00', endTime: '15:50:00', durationMin: 0.2 }, TZ)
    expect(mins(tiny)).toBeCloseTo(0.2)
    const readings = Array.from({ length: 24 * 60 }, (_, i) => ({ timestamp: tiny!.from.getTime() - 3_600_000 + i * 60_000, bpm: 150 }))
    const inside = readings.filter((r) => r.timestamp >= tiny!.from.getTime() && r.timestamp <= tiny!.to.getTime())
    expect(inside.length).toBeLessThan(2)
  })
  it('gives no window to an end equal to the start with an implausible duration', () => {
    expect(activityLogWindow({ date: '2026-07-01', startTime: '07:00', endTime: '07:00', durationMin: 241 }, TZ)).toBeNull()
    expect(mins(activityLogWindow({ date: '2026-07-01', startTime: '07:00', endTime: '07:00', durationMin: 240 }, TZ))).toBe(240)
  })
  it('does not trust a huge duration to replace a mistyped rolled end', () => {
    expect(activityLogWindow({ date: '2026-07-01', startTime: '15:50', endTime: '15:40', durationMin: 5000 }, TZ)).toBeNull()
  })
  it('gives no window to a rolled span over 4 h with no duration to confirm it', () => {
    expect(activityLogWindow({ date: '2026-07-01', startTime: '15:50', endTime: '15:40' }, TZ)).toBeNull()
    expect(activityLogWindow({ date: '2026-07-01', startTime: '15:50', endTime: '15:49' }, TZ)).toBeNull()
  })
  it('keeps a long genuine overnight log whose duration confirms it', () => {
    expect(mins(activityLogWindow({ date: '2026-07-01', startTime: '23:00', endTime: '07:00', durationMin: 480 }, TZ))).toBe(480)
  })
  it('keeps a short overnight log with no duration', () => {
    expect(mins(activityLogWindow({ date: '2026-07-01', startTime: '23:40', endTime: '00:20' }, TZ))).toBe(40)
  })
  it('keeps an overnight log whose duration matches', () => {
    const w = activityLogWindow({ date: '2026-07-01', startTime: '23:40', endTime: '00:20', durationMin: 40 }, TZ)
    expect(w?.from.toISOString()).toBe('2026-07-01T13:40:00.000Z')
    expect(w?.to.toISOString()).toBe('2026-07-01T14:20:00.000Z')
  })
  it('uses the duration from the start when the rolled span is over an hour off it', () => {
    // 15:50 to 15:40 would roll to 23 h 50 min; the log says 20 minutes.
    const w = activityLogWindow({ date: '2026-07-01', startTime: '15:50', endTime: '15:40', durationMin: 20 }, TZ)
    expect((w!.to.getTime() - w!.from.getTime()) / 60_000).toBe(20)
    // Exactly an hour off still rolls: the duration only wins past an hour.
    const edge = activityLogWindow({ date: '2026-07-01', startTime: '23:00', endTime: '00:00', durationMin: 120 }, TZ)
    expect((edge!.to.getTime() - edge!.from.getTime()) / 60_000).toBe(60)
    const over = activityLogWindow({ date: '2026-07-01', startTime: '23:00', endTime: '00:00', durationMin: 121 }, TZ)
    expect((over!.to.getTime() - over!.from.getTime()) / 60_000).toBe(121)
  })
  it('measures an overnight window across a clock change in the profile timezone', () => {
    // Sydney's daylight time ended at 03:00 on 5 Apr 2026 (clocks back to 02:00): 23:00 to 03:00 is
    // five real hours, not four.
    const w = activityLogWindow({ date: '2026-04-04', startTime: '23:00', endTime: '03:00', durationMin: 300 }, 'Australia/Sydney')
    expect((w!.to.getTime() - w!.from.getTime()) / 60_000).toBe(300)
    // With no duration the clock times alone are believed only up to 4 h: five real hours is past
    // the bound, two and a half is not.
    const bare = activityLogWindow({ date: '2026-04-04', startTime: '23:00', endTime: '01:30' }, 'Australia/Sydney')
    expect((bare!.to.getTime() - bare!.from.getTime()) / 60_000).toBe(150)
    expect(activityLogWindow({ date: '2026-04-04', startTime: '23:00', endTime: '03:00' }, 'Australia/Sydney')).toBeNull()
  })
})
