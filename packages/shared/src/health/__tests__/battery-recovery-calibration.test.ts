import { describe, it, expect } from 'vitest'
import {
  buildBatteryRecoveryCalibration,
  RECOVERY_LABELS,
} from '../battery-recovery-calibration'
import { ratingAsScore } from '../model-report-calibration'
import { MORNING_SCALES, storedOrderLabels } from '@trainingai/shared/types/day-checkin'

const build = (pairs: [string, number | null, number | null][]) =>
  buildBatteryRecoveryCalibration({
    from: pairs[0][0],
    to: pairs[pairs.length - 1][0],
    batteryByDate: new Map(pairs.map(([d, b]) => [d, b])),
    recoveryByDate: new Map(pairs.map(([d, , r]) => [d, r])),
  })

/** n days from 2026-07-01, with the given (battery, recovery) pairs. */
const days = (xs: [number | null, number | null][]): [string, number | null, number | null][] =>
  xs.map(([b, r], i) => [`2026-07-${String(i + 1).padStart(2, '0')}`, b, r])

describe('the stored scale runs 1 = fully recovered … 5 = wrecked', () => {
  it('takes its labels from the check-in itself, reversed into stored order', () => {
    // The check-in renders worst → best ("good on the right") and stores 6 − position. Restating a
    // reversed copy here is how the panel would keep labelling days with reworded copy.
    expect([...RECOVERY_LABELS]).toEqual(
      [...MORNING_SCALES.find(s => s.key === 'perceivedRecovery')!.labels].reverse(),
    )
    expect(RECOVERY_LABELS[0]).toBe('Recovered')
    expect(RECOVERY_LABELS[4]).toBe('Wrecked')
    expect(storedOrderLabels('sleepQualityFeel')[0]).toBe('Great')
  })

  it('maps the stored rating onto the model\'s higher-is-better axis', () => {
    // Getting this backwards inverts the reported agreement, and the raw production correlation is
    // NEGATIVE (r = −0.400) precisely because the stored scale runs the other way.
    expect(ratingAsScore(1)).toBe(100)
    expect(ratingAsScore(5)).toBe(0)
  })
})

describe('agreement direction — the sign that looks wrong', () => {
  it('reports strong POSITIVE agreement when a high battery pairs with a LOW stored rating', () => {
    // This is the production shape. A raw Pearson over (battery, storedRating) here is negative;
    // the panel must report it as agreement, not as the model contradicting the owner.
    const c = build(days([[30, 5], [35, 5], [45, 4], [50, 4], [60, 3], [65, 3], [75, 2], [85, 2], [95, 1]]))
    expect(c.paired).toBe(9)
    expect(c.spearman).toBeGreaterThan(0.95)
    expect(c.notes.join(' ')).toContain('orders days close to the way you do')
  })

  it('reports disagreement when a high battery pairs with feeling wrecked', () => {
    const c = build(days([[95, 5], [90, 5], [80, 4], [75, 4], [60, 3], [55, 3], [45, 2], [35, 2], [25, 1]]))
    expect(c.spearman).toBeLessThan(-0.95)
    expect(c.notes.join(' ')).toContain('OPPOSITE')
  })
})

describe('it speaks in days, not nights', () => {
  it('uses the day vocabulary in every note it can emit', () => {
    const thin = build(days([[80, 2], [70, 3]]))
    expect(thin.notes.join(' ')).toContain('days carry both a score and a rating')

    const outOfOrder = build(days([
      [50, 2], [52, 2], [80, 3], [82, 3], [30, 5], [32, 5], [40, 4], [42, 4], [20, 1], [22, 1],
    ]))
    expect(outOfOrder.notes.join(' ')).toContain('days you rated')
    expect(outOfOrder.notes.join(' ')).not.toContain('night')
  })
})

describe('buckets', () => {
  it('always returns all five ratings, with unused ones empty', () => {
    const c = build(days([[90, 2], [80, 3], [86, 2]]))
    expect(c.buckets.map(b => b.rating)).toEqual([1, 2, 3, 4, 5])
    expect(c.buckets.find(b => b.rating === 2)).toMatchObject({ count: 2, meanModelScore: 88 })
    expect(c.buckets.find(b => b.rating === 4)).toMatchObject({ count: 0, meanModelScore: null })
  })
})
