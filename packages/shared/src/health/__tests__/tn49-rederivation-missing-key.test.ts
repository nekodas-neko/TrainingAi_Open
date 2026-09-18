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
 */
import { describe, it, expect } from 'vitest'
import { rederiveReadinessFromStored, READINESS_WEIGHTS } from '../readiness-composite'

/** A contributor whose stored input is null rederives to the model's neutral 50 — so this shape is
 *  only honest at score 50, where stored and rederived agree and nothing drifts. */
const neutral = (score: number) => ({ score, provisional: false, input: null, gap: null })

/** The pre-Q-501 shape: a score with no `input` beside it. It cannot be re-derived, so it is
 *  `uncheckable` and carries its own stored score into the weighted sum — which is what lets a case
 *  below use scores other than 50 without inventing inputs that would have to rederive to them. */
const stored = (score: number) => ({ score, provisional: false })

const completeMap = (score = 50) =>
  Object.fromEntries(Object.keys(READINESS_WEIGHTS).map(k => [k, neutral(score)]))

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
    const r = rederiveReadinessFromStored(completeMap(50))
    expect(r?.score).toBe(50)
    expect(r?.drifted).toEqual([])
    expect(r?.uncheckable).toEqual([])
  })

  it('reports nothing missing for a complete map', () => {
    expect(rederiveReadinessFromStored(completeMap(50))?.missing).toEqual([])
  })

  it('does not drop the weight of a key that is absent', () => {
    const eight = completeMap(50)
    delete eight.checkin

    const r = rederiveReadinessFromStored(eight)
    // Skipping the key left 0.90 of weight and gave 45. The row's own score was 50.
    expect(r?.score).toBe(50)
    expect(r?.missing).toEqual(['checkin'])
  })

  /**
   * The same thing where it is visible in more than the last digit: eight contributors at 80 and
   * `checkin` absent. The neutral 50 stands in for the missing key, so 0.90×80 + 0.10×50 = 77.
   * Dropping the weight gave 72 — a five-point hole with nothing on the row to explain it.
   */
  it('stands the model neutral in for the missing key rather than renormalising', () => {
    const eight = Object.fromEntries(
      Object.keys(READINESS_WEIGHTS).filter(k => k !== 'checkin').map(k => [k, stored(80)]),
    )

    // 0.90 × 80 + 0.10 × 50 = 77. Dropping the key's weight gave 72 — a five-point hole with
    // nothing on the row to explain it.
    expect(rederiveReadinessFromStored(eight)?.score).toBe(77)
  })

  /**
   * `missing` and `uncheckable` are different facts and must not be collapsed. A key that is
   * PRESENT but carries no `input` field is a pre-Q-501 row: its score is known and simply cannot be
   * re-derived. A key that is ABSENT has no score at all.
   */
  it('separates a key that is absent from one that is present without an input', () => {
    const map = completeMap(50) as Record<string, unknown>
    map.temperature = { score: 64, provisional: false }   // present, no `input` → uncheckable
    delete map.checkin                                    // absent → missing

    const r = rederiveReadinessFromStored(map)
    expect(r?.uncheckable).toEqual(['temperature'])
    expect(r?.missing).toEqual(['checkin'])
  })

  it('still detects a contributor whose stored score does not follow from its stored input', () => {
    const map = completeMap(50) as Record<string, unknown>
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
   * has asserted since before this fix — *"checkin carried 0.10 of the weight and is now absent
   * from the sum entirely."*
   *
   * The two look alike and are not. An absent key has no score, so standing the model's own neutral
   * in reproduces what the composite did. A present key with a corrupt score is a value that cannot
   * be read, and inventing 50 would assert something the row does not say. The present-but-unusable
   * path therefore KEEPS the low-by-`weight × score` trap — accepted, because no production row has
   * ever been in that state and the alternative is overturning a deliberate decision on no evidence.
   */
  it('treats a present-but-unusable score differently from an absent key', () => {
    const present = completeMap(50) as Record<string, unknown>
    present.checkin = { score: null, provisional: false }   // present, unreadable → skipped
    const absent = completeMap(50)
    delete absent.checkin                                   // absent → neutral 50 stands in

    // Skipped: 0.90 of weight at 50 = 45. Stood in for: the full 1.00 at 50 = 50.
    expect(rederiveReadinessFromStored(present)?.score).toBe(45)
    expect(rederiveReadinessFromStored(absent)?.score).toBe(50)
    // And only the absent one is reported as missing — the skipped one is not claimed either way.
    expect(rederiveReadinessFromStored(present)?.missing).toEqual([])
    expect(rederiveReadinessFromStored(absent)?.missing).toEqual(['checkin'])
  })

  it('returns null when nothing in the map is a contributor at all', () => {
    expect(rederiveReadinessFromStored({ nonsense: 1 })).toBeNull()
    expect(rederiveReadinessFromStored(null)).toBeNull()
  })

  /**
   * The production shape, reconstructed from the real row of 2026-07-20: the eight stored
   * contributors weight to 43.26 and the stored score is 48. Under the old code the row read 43 and
   * was reported as a 5-point model drift; the neutral 50 for the absent `checkin` gives 48 exactly.
   *
   * **Three of the seven rows keep a 1-point residual that this does NOT explain** (07-16, 07-17,
   * 07-21) and no value in `CHECKIN_ENERGY_SCORE` reproduces them, so that remainder is recorded as
   * unexplained rather than fitted. This case uses one of the four that resolve exactly.
   */
  it('resolves the production row of 2026-07-20', () => {
    // 43.26 of stored weight across the eight present keys, as measured.
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

    const r = rederiveReadinessFromStored(map)
    expect(r?.missing).toEqual(['checkin'])
    expect(r?.score).toBe(48)
  })
})
