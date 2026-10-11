import { describe, it, expect } from 'vitest'
import {
  computeSleepScore, sleepScoreCalibrationFor, SLEEP_MODEL, SLEEP_SCORE_V2_FROM, SLEEP_SCORE_MODEL_VERSIONS,
} from '../sleep-score'
import { buildSleepAudit } from '../score-audit/sleep'

// #2237 (TN-5, owner sign-off 2026-08-24): an even-gain calibration for new nights, chosen by the
// night's wake date so stored and recomputed history keeps the curve it was scored on.
const TZ = 'Australia/Brisbane'
const V2 = SLEEP_MODEL.curves.scoreCalibration
const V1 = SLEEP_MODEL.curves.scoreCalibrationBefore

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

describe('which curve scores a night', () => {
  it('is chosen by the wake date, with the version stamped on the result', () => {
    expect(sleepScoreCalibrationFor('2026-10-13').modelVersion).toBe(SLEEP_SCORE_MODEL_VERSIONS.v1)
    expect(sleepScoreCalibrationFor(SLEEP_SCORE_V2_FROM).modelVersion).toBe(SLEEP_SCORE_MODEL_VERSIONS.v2)
    // A slash key is normalised first: '/' sorts above '-', which would put every such date on V2.
    expect(sleepScoreCalibrationFor('2026/10/13').modelVersion).toBe(SLEEP_SCORE_MODEL_VERSIONS.v1)
    expect(sleepScoreCalibrationFor('2026/10/14').modelVersion).toBe(SLEEP_SCORE_MODEL_VERSIONS.v2)
  })

  it('scores the same night differently either side of the cutover, only above blend 65.4', () => {
    // A middling night lands on V1's steep middle, where the two curves differ most.
    const mid = { efficiency: 86, remSleepHours: 1.4, deepSleepHours: 1.0, onsetLatencySec: 15 * 60 }
    const before = computeSleepScore(night('2026-10-13', mid), TZ)!
    const after = computeSleepScore(night(SLEEP_SCORE_V2_FROM, mid), TZ)!
    expect(before.modelVersion).toBe(SLEEP_SCORE_MODEL_VERSIONS.v1)
    expect(after.modelVersion).toBe(SLEEP_SCORE_MODEL_VERSIONS.v2)
    expect(after.components).toEqual(before.components)
    expect(after.score).not.toBe(before.score)

    // A short, poor night blends under 65.4, where the curves are identical.
    const poor = { durationHours: 3.5, efficiency: 70 }
    expect(computeSleepScore(night(SLEEP_SCORE_V2_FROM, poor), TZ)!.score)
      .toBe(computeSleepScore(night('2026-10-13', poor), TZ)!.score)
  })

  it('a backfill persists the stamp beside the score', () => {
    // 23:00 -> 07:00 Brisbane, waking on the cutover date (the audit finds a night by its local wake).
    const s = night(SLEEP_SCORE_V2_FROM, {
      efficiency: 90, sleepStart: new Date('2026-10-13T13:00:00Z'), sleepEnd: new Date('2026-10-13T21:00:00Z'),
    })
    const audit = buildSleepAudit({ date: SLEEP_SCORE_V2_FROM, tz: TZ, sleepSessions: [s], derived: null })
    expect(audit.persist).toMatchObject({ modelVersion: SLEEP_SCORE_MODEL_VERSIONS.v2 })
  })
})
