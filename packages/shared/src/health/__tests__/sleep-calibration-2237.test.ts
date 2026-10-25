import { describe, it, expect } from 'vitest'
import {
  computeSleepScore, sleepScoreCalibrationFor, SLEEP_MODEL, SLEEP_SCORE_V2_FROM, SLEEP_SCORE_MODEL_VERSIONS,
} from '../sleep-score'
import { buildSleepAudit } from '../score-audit/sleep'

// #2237 (TN-5, owner sign-off 2026-08-24, approved again 2026-10-26): an even-gain calibration for new
// nights, chosen by the night's wake date so stored and recomputed history keeps the curve it was
// scored on. `SLEEP_SCORE_V2_FROM` is null until release prep sets it, so the curve is exercised here
// through the `v2From` override.
const TZ = 'Australia/Brisbane'
const V2 = SLEEP_MODEL.curves.scoreCalibrationV2
const V1 = SLEEP_MODEL.curves.scoreCalibrationBefore
const CUTOVER = '2026-10-14'
const live = { v2From: CUTOVER }

const night = (date: string, over: Record<string, unknown> = {}) => ({
  id: 's1', userId: 'u1', date,
  sleepStart: new Date('2026-07-08T13:00:00Z'), sleepEnd: new Date('2026-07-08T21:00:00Z'),
  createdAt: new Date('2026-07-09T00:00:00Z'), durationHours: 8, ...over,
}) as never

describe('the V2 calibration curve', () => {
  it('has even gain above blend 65.4: every segment within 1.2x of every other (the pass test)', () => {
    const gains: number[] = []
    for (let i = 1; i < V2.length; i++) {
      const [x0, y0] = V2[i - 1], [x1, y1] = V2[i]
      if (x0 >= 65.4) gains.push((y1 - y0) / (x1 - x0))
    }
    expect(gains).toHaveLength(7)
    expect(Math.max(...gains) / Math.min(...gains)).toBeLessThanOrEqual(1.2)
  })

  it('keeps V1 up to 65.4, the zero and the [93, 100] ceiling anchor', () => {
    const upTo = (c: typeof V1 | typeof V2) => c.filter(([x]) => x <= 65.4)
    expect(upTo(V2)).toEqual(upTo(V1))
    expect(V2[V2.length - 1]).toEqual([93, 100])
  })
})

describe('until release prep sets the cutover', () => {
  it('is not set, so nothing moves: every night scores on V1, however new', () => {
    expect(SLEEP_SCORE_V2_FROM).toBeNull()
    expect(sleepScoreCalibrationFor('2026-12-01').modelVersion).toBe(SLEEP_SCORE_MODEL_VERSIONS.v1)
    expect(sleepScoreCalibrationFor('').modelVersion).toBe(SLEEP_SCORE_MODEL_VERSIONS.v1)
    expect(SLEEP_MODEL.curves.scoreCalibration).toBe(V1)
    expect(computeSleepScore(night('2026-12-01'), TZ)!.modelVersion).toBe(SLEEP_SCORE_MODEL_VERSIONS.v1)
  })
})

describe('which curve scores a night', () => {
  it('is chosen by the wake date, with the version stamped on the result', () => {
    expect(sleepScoreCalibrationFor('2026-10-13', CUTOVER).modelVersion).toBe(SLEEP_SCORE_MODEL_VERSIONS.v1)
    expect(sleepScoreCalibrationFor(CUTOVER, CUTOVER).modelVersion).toBe(SLEEP_SCORE_MODEL_VERSIONS.v2)
    // A slash key is normalised first: '/' sorts above '-', which would put every such date on V2.
    expect(sleepScoreCalibrationFor('2026/10/13', CUTOVER).modelVersion).toBe(SLEEP_SCORE_MODEL_VERSIONS.v1)
    expect(sleepScoreCalibrationFor('2026/10/14', CUTOVER).modelVersion).toBe(SLEEP_SCORE_MODEL_VERSIONS.v2)
  })

  it('scores the same night differently either side of the cutover, only above blend 65.4', () => {
    // A middling night lands on V1's steep middle, where the two curves differ most.
    const mid = { efficiency: 86, remSleepHours: 1.4, deepSleepHours: 1.0, onsetLatencySec: 15 * 60 }
    const before = computeSleepScore(night('2026-10-13', mid), TZ, live)!
    const after = computeSleepScore(night(CUTOVER, mid), TZ, live)!
    expect(before.modelVersion).toBe(SLEEP_SCORE_MODEL_VERSIONS.v1)
    expect(after.modelVersion).toBe(SLEEP_SCORE_MODEL_VERSIONS.v2)
    expect(after.components).toEqual(before.components)
    expect(after.score).not.toBe(before.score)

    // A short, poor night blends under 65.4, where the curves are identical.
    const poor = { durationHours: 3.5, efficiency: 70 }
    expect(computeSleepScore(night(CUTOVER, poor), TZ, live)!.score)
      .toBe(computeSleepScore(night('2026-10-13', poor), TZ, live)!.score)
  })

  it('a backfill persists the V1 stamp beside the score while the cutover is unset', () => {
    // 23:00 -> 07:00 Brisbane, waking on the date the audit looks up.
    const s = night(CUTOVER, {
      efficiency: 90, sleepStart: new Date('2026-10-13T13:00:00Z'), sleepEnd: new Date('2026-10-13T21:00:00Z'),
    })
    const audit = buildSleepAudit({ date: CUTOVER, tz: TZ, sleepSessions: [s], derived: null })
    expect(audit.persist).toMatchObject({ modelVersion: SLEEP_SCORE_MODEL_VERSIONS.v1 })
  })
})

// The two ceiling fixtures went stale: the 2026-08-17 recalibration raised the REM ceiling to 3.0 h,
// so 2.2 h of REM is not a maximal night, and an excellent-but-not-maximal night lands in the low 90s
// on an even curve (V1's 96 came from its flat top, the compression this curve removes).
describe('the ceiling on V2', () => {
  it('a perfect night, with 3.0 h of REM, still scores 100', () => {
    const perfect = computeSleepScore(night(CUTOVER, {
      sleepStart: new Date('2026-10-13T12:30:00Z'), sleepEnd: new Date('2026-10-13T21:30:00Z'),
      durationHours: 9, efficiency: 100, deepSleepHours: 1.7, remSleepHours: 3.0,
      awakHours: 0, onsetLatencySec: 720, restlessPeriods: 0,
    }), TZ, live)!
    expect(perfect.score).toBe(100)
  })

  it('an excellent night (1.8 h REM, below the owner’s median) scores 90–93, not the high 90s', () => {
    const excellent = computeSleepScore(night(CUTOVER, {
      durationHours: 8.5, efficiency: 96, onsetLatencySec: 12 * 60, restlessPeriods: 2,
      remSleepHours: 1.8, deepSleepHours: 1.6,
    }), TZ, live)!
    expect(excellent.score).toBeGreaterThanOrEqual(90)
    expect(excellent.score).toBeLessThanOrEqual(93)
  })
})
