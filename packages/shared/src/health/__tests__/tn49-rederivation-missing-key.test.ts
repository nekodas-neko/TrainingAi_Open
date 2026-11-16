/**
 * TN-49 — an absent contributor key used to read as a score disagreement.
 *
 * `READINESS_WEIGHTS` is defined to sum to exactly 1.00. `rederiveReadinessFromStored` skipped any
 * key missing from the stored map, which dropped that key's weight from the sum, so the result came
 * out low by roughly `weight × 50` — and the score-audit surface then reported the row as "NOT
 * reproducible from its own stored inputs", which is a claim about the MODEL having moved.
 *
 * **Measured on production 2026-09-18**, which is what settled it: 7 of 65 rows disagreed with their
 * stored score, and those 7 are exactly the 7 rows storing **eight** contributors instead of nine.
 * The missing key is `checkin` (weight 0.10) on every one of them. All 58 nine-key rows reproduce
 * exactly. The entry that reported this proposed rewriting the seven stored scores to the
 * under-weighted numbers, which would have written a 4–6 point error into production.
 *
 * `checkin` left the model in #2224, so those seven rows are no longer missing anything. The rule
 * stands for the next key that goes missing; the cases below use `temperature` (weight 1/9) as the
 * absent key, and the last one shows the 2026-07-20 row under the current model.
 */
import { describe, it, expect } from 'vitest'
import { rederiveReadinessFromStored, READINESS_WEIGHTS } from '../readiness-composite'

/** A contributor whose stored input is null rederives to the model's neutral — so this shape is only
 *  honest at that neutral, where stored and rederived agree and nothing drifts. Since #3778 the
 *  neutral is 75 for resting HR, HRV and sleep balance and 50 for the rest. */
const neutral = (score: number) => ({ score, provisional: false, input: null, gap: null })

/** The pre-Q-501 shape: a score with no `input` beside it. It cannot be re-derived, so it is
 *  `uncheckable` and carries its own stored score into the weighted sum — which is what lets a case
 *  below use scores other than 50 without inventing inputs that would have to rederive to them. */
const stored = (score: number) => ({ score, provisional: false })

const CENTRED = new Set(['restingHeartRate', 'hrvBalance', 'sleepBalance'])
/** Every key at its own neutral: 0.444 × 75 + 0.556 × 50 = 61 (#3778; it was 50). */
const completeMap = () =>
  Object.fromEntries(Object.keys(READINESS_WEIGHTS).map(k => [k, neutral(CENTRED.has(k) ? 75 : 50)]))

describe('TN-49 — a contributor key absent from the stored map', () => {
  it('sums the weights to 1.00, which is why a dropped key shows up as a score change', () => {
    const total = Object.values(READINESS_WEIGHTS).reduce((a, b) => a + b, 0)
    expect(total).toBeCloseTo(1, 10)
  })

  /**
   * THE control, and deliberately equivalent: it asserts only what must be **unchanged** for a
   * complete map, so it passes against the code before this fix as well as after. Without it, every
   * case here would be exercising the new `missing` field and none would be holding the behaviour
   * the fix was not allowed to move.
   */
  it('leaves a complete map exactly as it was', () => {
    const r = rederiveReadinessFromStored(completeMap())
    expect(r?.score).toBe(61)
    expect(r?.drifted).toEqual([])
    expect(r?.uncheckable).toEqual([])
  })

  it('reports nothing missing for a complete map', () => {
    expect(rederiveReadinessFromStored(completeMap())?.missing).toEqual([])
  })

  it('does not drop the weight of a key that is absent', () => {
    const seven = completeMap()
    delete seven.temperature

    const r = rederiveReadinessFromStored(seven)
    // Skipping the key left 8/9 of the weight and gave 56. The row's own score was 61.
    expect(r?.score).toBe(61)
    expect(r?.missing).toEqual(['temperature'])
  })

  /**
   * The same thing where it is visible in more than the last digit: seven contributors at 80 and
   * `temperature` absent. The neutral 50 stands in for the missing key, so 8/9×80 + 1/9×50 = 77.
   * Dropping the weight gave 71 — a six-point hole with nothing on the row to explain it.
   */
  it('stands the model neutral in for the missing key rather than renormalising', () => {
    const seven = Object.fromEntries(
      Object.keys(READINESS_WEIGHTS).filter(k => k !== 'temperature').map(k => [k, stored(80)]),
    )

    expect(rederiveReadinessFromStored(seven)?.score).toBe(77)
  })

  /**
   * `missing` and `uncheckable` are different facts and must not be collapsed. A key that is
   * PRESENT but carries no `input` field is a pre-Q-501 row: its score is known and simply cannot be
   * re-derived. A key that is ABSENT has no score at all.
   */
  it('separates a key that is absent from one that is present without an input', () => {
    const map = completeMap() as Record<string, unknown>
    map.sleepBalance = { score: 64, provisional: false }  // present, no `input` → uncheckable
    delete map.temperature                                // absent → missing

    const r = rederiveReadinessFromStored(map)
    expect(r?.uncheckable).toEqual(['sleepBalance'])
    expect(r?.missing).toEqual(['temperature'])
  })

  it('still detects a contributor whose stored score does not follow from its stored input', () => {
    const map = completeMap() as Record<string, unknown>
    // previousNight passes its input through, so a stored score of 50 against an input of 90 is
    // drift by definition.
    map.previousNight = { score: 50, provisional: false, input: 90, gap: null }

    // Drift detection is the other thing the fix was not allowed to move, so this asserts it
    // without reference to `missing` — it too passes on both sides.
    expect(rederiveReadinessFromStored(map)?.drifted)
      .toEqual([{ key: 'previousNight', stored: 50, rederived: 90 }])
  })

  /**
   * The asymmetry, pinned deliberately. An ABSENT key gets the model's neutral; a key that is
   * PRESENT with an unusable score stays skipped, which is what `readiness-stored-inputs.test.ts`
   * has asserted since before this fix — the unusable term's weight is absent from the sum entirely.
   *
   * The two look alike and are not. An absent key has no score, so standing the model's own neutral
   * in reproduces what the composite did. A present key with a corrupt score is a value that cannot
   * be read, and inventing 50 would assert something the row does not say. The present-but-unusable
   * path therefore KEEPS the low-by-`weight × score` trap — accepted, because no production row has
   * ever been in that state and the alternative is overturning a deliberate decision on no evidence.
   */
  it('treats a present-but-unusable score differently from an absent key', () => {
    const present = completeMap() as Record<string, unknown>
    present.temperature = { score: null, provisional: false }   // present, unreadable → skipped
    const absent = completeMap()
    delete absent.temperature                                   // absent → neutral 50 stands in

    // Skipped: temperature's 1/9 is missing from the sum, 56. Stood in for: the full 1.00, 61.
    expect(rederiveReadinessFromStored(present)?.score).toBe(56)
    expect(rederiveReadinessFromStored(absent)?.score).toBe(61)
    // And only the absent one is reported as missing — the skipped one is not claimed either way.
    expect(rederiveReadinessFromStored(present)?.missing).toEqual([])
    expect(rederiveReadinessFromStored(absent)?.missing).toEqual(['temperature'])
  })

  it('returns null when nothing in the map is a contributor at all', () => {
    expect(rederiveReadinessFromStored({ nonsense: 1 })).toBeNull()
    expect(rederiveReadinessFromStored(null)).toBeNull()
  })

  /**
   * The production shape, reconstructed from the real row of 2026-07-20: the eight stored
   * contributors weighted to 43.26 under the old 0.90 they held, and the stored score is 48. Under
   * the old code the row read 43 and was reported as a 5-point model drift; TN-49's neutral 50 for
   * the absent `checkin` gave 48. Since #2224 the model has exactly these eight keys, so nothing is
   * missing and their renormalised weight gives 43.26 / 0.90 = 48.07 — still 48.
   *
   * **Three of the seven rows kept a 1-point residual that TN-49 did NOT explain** (07-16, 07-17,
   * 07-21), recorded as unexplained rather than fitted. This case uses one of the four that resolve
   * exactly.
   */
  it('resolves the production row of 2026-07-20', () => {
    // 43.26 of stored weight across the eight present keys, under the pre-#2224 weights.
    const map: Record<string, unknown> = {
      restingHeartRate: stored(40),   // 6.00
      previousNight:    stored(45),   // 7.20
      hrvBalance:       stored(38),   // 5.70
      temperature:      stored(52),   // 5.20
      sleepBalance:     stored(44),   // 4.40
      prevDayActivity:  stored(50),   // 4.50
      recoveryIndex:    stored(50),   // 4.50
      activityBalance:  stored(96),   // 5.76
    }                                 // → 43.26

    // #3358 (v15): `prevDayActivity` left the model and `activityBalance` took its share, so the
    // current model re-derives this row to (43.26 − 4.50 − 5.76 + 96 × 0.15) / 0.90 = 52.67. That is
    // a model change, stamped on the row; under v14 weights it read 48 as described above.
    const r = rederiveReadinessFromStored(map)
    expect(r?.missing).toEqual([])
    expect(r?.score).toBe(53)
  })
})
