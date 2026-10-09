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
    'components/cardio/todays-cardio-copy.ts',
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
