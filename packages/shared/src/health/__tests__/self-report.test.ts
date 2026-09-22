/**
 * TN-57 — an untouched scale is not an answer.
 *
 * Measured on production 2026-09-22 over the owner's 97 morning check-ins: 78 carry a
 * `perceived_recovery` and **0** of them were ever touched, across 2 distinct values with a
 * standard deviation of 0.286. Every reader treated those 78 as self-reports.
 */
import { describe, it, expect } from 'vitest'
import { answeredMorningScales } from '@trainingai/shared/health/self-report'

const row = (over: Partial<Parameters<typeof answeredMorningScales>[0]> = {}) => ({
  perceivedRecovery: 3, sleepQualityFeel: 3,
  perceivedRecoveryTouched: false, sleepQualityFeelTouched: false,
  ...over,
})

describe('answeredMorningScales', () => {
  it('drops a seeded value the lifter never moved', () => {
    expect(answeredMorningScales(row())).toEqual({ perceivedRecovery: null, sleepQualityFeel: null })
  })

  it('keeps a value the lifter did move', () => {
    expect(answeredMorningScales(row({ perceivedRecovery: 5, perceivedRecoveryTouched: true })))
      .toEqual({ perceivedRecovery: 5, sleepQualityFeel: null })
  })

  /**
   * The two flags are independent in the data — `sleep_quality_feel` was touched 3 times while
   * `perceived_recovery` was touched 0 — so one must never gate the other.
   */
  it('resolves each scale on its own flag', () => {
    expect(answeredMorningScales(row({ sleepQualityFeel: 2, sleepQualityFeelTouched: true })))
      .toEqual({ perceivedRecovery: null, sleepQualityFeel: 2 })
  })

  /**
   * A touched scale whose value is genuinely null stays null — the flag says the lifter engaged
   * with the control, not that a number must exist.
   */
  it('does not invent a value for a touched-but-null scale', () => {
    expect(answeredMorningScales(row({ perceivedRecovery: null, perceivedRecoveryTouched: true })).perceivedRecovery)
      .toBeNull()
  })

  /**
   * The seeded value is 3, so a check that only asked "is it 3?" would pass this suite and fail on
   * the day the lifter genuinely answers 3. The flag is the whole signal.
   */
  it('keeps a touched 3, which is the case a value-based check would get wrong', () => {
    expect(answeredMorningScales(row({ perceivedRecoveryTouched: true })).perceivedRecovery).toBe(3)
  })
})
