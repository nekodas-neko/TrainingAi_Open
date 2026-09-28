import { describe, it, expect } from 'vitest'
import { saveSleepValue } from '@/components/checkin/save-sleep-value'
import { verdictToStoredFeel } from '@/components/health/sleep/sleep-verdict-copy'
import { dayCheckinHasAnswers } from '@trainingai/shared/validation/day-checkin'
import { answeredMorningScales } from '@trainingai/shared/health/self-report'
import type { StoredSleepVerdict } from '@/components/health/sleep/sleep-verdict-copy'
import type { SleepVerdict } from '@trainingai/shared/health/sleep-verdict'

const announced = (verdict: SleepVerdict) => ({ verdict } as StoredSleepVerdict)

/**
 * TN-82 — the check-in announces its own answer, and only a CORRECTION is his.
 *
 * Two independent things are pinned here, and both are the kind that fail silently:
 *
 *   1. **The plan's hard constraint (§4):** the auto-filled value writes `touched: false`; only a
 *      correction writes `true`. An auto-fill that flagged itself touched would destroy the variable
 *      this design exists to create and re-create TN-57 — 91 days of a default presented back to the
 *      owner as his own answer, on two surfaces.
 *   2. **The numeric invariant.** `dayCheckinHasAnswers` (Q-465) rejects a body with no answer:
 *      a 400 on the web route, and a no-retry poison pill in `pushMutations`. Its own header says it
 *      has never fired because *"both live writers always send at least two numeric scales"* —
 *      a property TN-82 removes by deleting both scales. If this helper ever returns a non-number,
 *      the morning check-in stops reaching the server and the sheet re-prompts forever.
 */
describe('saveSleepValue', () => {
  it('writes the ANNOUNCED verdict untouched — the app filled it, so it is not his answer', () => {
    for (const v of ['good', 'normal', 'poor'] as SleepVerdict[]) {
      const w = saveSleepValue(null, announced(v))
      expect(w.value, v).toBe(verdictToStoredFeel(v))
      expect(w.touched, `${v} auto-fill must NOT be touched`).toBe(false)
    }
  })

  it('writes a correction as HIS, touched', () => {
    const w = saveSleepValue(5, announced('normal'))
    expect(w).toEqual({ value: 5, touched: true })
  })

  it('prefers the correction over the announcement, which is the whole instrument', () => {
    expect(saveSleepValue(1, announced('poor')).value).toBe(1)
  })

  it('falls back to a neutral, untouched value when there is nothing to announce', () => {
    const w = saveSleepValue(null, null)
    expect(w.touched).toBe(false)
    expect(typeof w.value).toBe('number')
  })

  it('never yields a non-number, so the save always carries an answer', () => {
    const cases: [number | null, StoredSleepVerdict | null][] = [
      [null, null], [null, announced('normal')], [null, announced('poor')],
      [null, announced('good')], [3, null], [1, announced('good')],
    ]
    for (const [correction, verdict] of cases) {
      const { value } = saveSleepValue(correction, verdict)
      expect(Number.isInteger(value), `${correction}/${verdict?.verdict}`).toBe(true)
      // The real guard, called directly rather than described: a body carrying only this value must
      // still read as an answer once the two scales are gone.
      expect(
        dayCheckinHasAnswers({ sleepQualityFeel: value, soreMuscles: [], journal: null, illnessContext: null, vsYesterday: null }),
        'the save would be rejected as empty — 400 on the route, poison pill in the outbox',
      ).toBe(true)
    }
  })

  it('is invisible to every reader until he corrects it', () => {
    const auto = saveSleepValue(null, announced('poor'))
    expect(answeredMorningScales({
      perceivedRecovery: null, perceivedRecoveryTouched: false,
      sleepQualityFeel: auto.value, sleepQualityFeelTouched: auto.touched,
    }).sleepQualityFeel, 'an announcement he never answered must not read as a self-report').toBeNull()

    const his = saveSleepValue(4, announced('normal'))
    expect(answeredMorningScales({
      perceivedRecovery: null, perceivedRecoveryTouched: false,
      sleepQualityFeel: his.value, sleepQualityFeelTouched: his.touched,
    }).sleepQualityFeel).toBe(4)
  })
})

describe('verdictToStoredFeel', () => {
  it('lands the three verdicts in the middle of the scale, right way round', () => {
    // Stored runs 1 = slept great … 5 = terrible, so GOOD is the LOWER number. Asserting the
    // ordering rather than the literals is what catches an inversion that still type-checks.
    const [good, normal, poor] = (['good', 'normal', 'poor'] as SleepVerdict[]).map(verdictToStoredFeel)
    expect(good).toBeLessThan(normal)
    expect(normal).toBeLessThan(poor)
    expect(good).toBeGreaterThan(1)
    expect(poor).toBeLessThan(5)
  })
})
