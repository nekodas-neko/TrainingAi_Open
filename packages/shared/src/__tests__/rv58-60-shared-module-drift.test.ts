/**
 * RV-58/59/60 — three shared modules whose stated contract and behaviour had drifted apart.
 *
 * Batched because they share exactly one thing: each is a pure shared function whose defect is only
 * visible by calling it, so they verify together in one file with no fixtures and no database.
 */
import { describe, it, expect } from 'vitest'
import { buildEquipmentSet, equipmentEligible } from '@trainingai/shared/workout/equipment'
import { summariseSupplementDay } from '@trainingai/shared/nutrition/supplement-day-totals'
import { recommendWalkPattern, WALK_PATTERNS } from '@trainingai/shared/walking/recommend-walk-pattern'
import type { ZoneQuota } from '@trainingai/shared/health/zone-quota'

// ── RV-58 ──────────────────────────────────────────────────────────────────────

describe('RV-58 — equipment matching folds case on BOTH sides', () => {
  /**
   * The asymmetry, stated as the mirror it is. `equipmentEligible` lowercases the exercise's labels;
   * `buildEquipmentSet` did not lowercase the owner's. So one direction worked and its mirror did
   * not — which is exactly what makes half-coverage read as case-insensitivity.
   */
  it.each([
    ['exercise upper, owned lower', ['Barbell'], ['barbell']],
    ['exercise lower, owned upper', ['barbell'], ['Barbell']],
    ['both upper', ['BARBELL'], ['BARBELL']],
  ])('%s', (_label, exercise, owned) => {
    expect(equipmentEligible(exercise, buildEquipmentSet(owned))).toBe(true)
  })

  it('expands the full_gym shorthand whatever case it arrives in', () => {
    const set = buildEquipmentSet(['FULL_GYM'])
    expect(set.has('full_gym')).toBe(false)          // the shorthand is a grant, not a value
    expect(equipmentEligible(['machine'], set)).toBe(true)
    expect(equipmentEligible(['Cable'], set)).toBe(true)
  })

  /** The control: folding case must not make unrelated kit match. */
  it('still refuses equipment the lifter does not have', () => {
    expect(equipmentEligible(['Machine'], buildEquipmentSet(['barbell']))).toBe(false)
  })
})

// ── RV-59 ──────────────────────────────────────────────────────────────────────

const log = (amount: number | null, unit: string | null) => ({
  supplementId: 's1', amount, unit, source: 'manual' as const, doseText: null,
})
const day = (...logs: ReturnType<typeof log>[]) =>
  summariseSupplementDay(logs as never)!.get('s1')!.loggedAmount

describe('RV-59 — a mixed-unit day reports no total rather than a wrong one', () => {
  /**
   * THE case. It used to add the numbers and label the sum with whichever unit the loop saw first,
   * so the same day reported `3 mg` or `3 g` depending only on row order. Both orders are asserted,
   * because "depends on row order" is the defect and one order alone cannot show it.
   */
  it.each([
    ['mg then g', log(1, 'mg'), log(2, 'g')],
    ['g then mg', log(2, 'g'), log(1, 'mg')],
  ])('refuses to total %s', (_label, a, b) => {
    const amount = day(a, b)
    expect(amount.mixedUnits).toBe(true)
    expect(amount.amount).toBeNull()
    expect(amount.unit).toBeNull()
    expect(amount.contributions).toBe(2)
  })

  /** The deliberately equivalent control: one unit still totals, which is the whole point of the
   *  field. A fix that simply stopped summing would pass every case above. */
  it('still totals a single-unit day', () => {
    const amount = day(log(1, 'mg'), log(2, 'mg'))
    expect(amount).toMatchObject({ amount: 3, unit: 'mg', contributions: 2 })
    expect(amount.mixedUnits).toBeUndefined()
  })

  /**
   * The case that a first draft of the fix got wrong, found by reasoning rather than by a failure:
   * a tick with NO amount still increments `contributions`. Counting those as "a previous
   * contribution" made the next real number compare against a unit nobody had set, and an ordinary
   * day came out mixed.
   */
  it('does not call a day mixed because an earlier tick carried no number', () => {
    const amount = day(log(null, 'mg'), log(5, 'mg'))
    expect(amount.mixedUnits).toBeUndefined()
    expect(amount.amount).toBe(5)
  })

  /**
   * A null unit INHERITS rather than conflicting, and this case exists because my first version got
   * it wrong. It treated null as a distinct unit and broke
   * `components/nutrition/__tests__/supplement-day-totals.test.ts`'s "takes the unit from the first
   * contribution that HAS one" — a deliberate prior decision. RV-59's measurement is `mg` against
   * `g`; it says nothing about null, so overriding that decision would have been a change on no
   * evidence. A substance logged once without a unit is far likelier to be unrecorded than to be a
   * different unit.
   */
  it.each([
    ['unitless first', log(1, null), log(2, 'mg')],
    ['unitless second', log(1, 'mg'), log(2, null)],
  ])('inherits a named unit across a %s contribution', (_label, a, b) => {
    const amount = day(a, b)
    expect(amount.mixedUnits).toBeUndefined()
    expect(amount.amount).toBe(3)
    expect(amount.unit).toBe('mg')
  })

  /** Null amounts alone still mean "taken, quantity unknown" — not zero, and not mixed. */
  it('reports no amount and no mix when nothing carried a number', () => {
    const amount = day(log(null, 'mg'), log(null, 'mg'))
    expect(amount.amount).toBeNull()
    expect(amount.mixedUnits).toBeUndefined()
    expect(amount.contributions).toBe(2)
  })
})

// ── RV-60 ──────────────────────────────────────────────────────────────────────

const quota = (zone2: Partial<ZoneQuota['zones'][number]> | null): ZoneQuota => ({
  zones: zone2 ? [{
    zoneId: 2, targetMin: 0, doneMin: 0, remainingMin: 0, pctComplete: 0,
    status: 'not-required', ...zone2,
  } as ZoneQuota['zones'][number]] : [],
} as ZoneQuota)

describe('RV-60 — "no target" and "target met" are told apart', () => {
  /**
   * `computeZoneQuota` represents "no target" as a row with `status: 'not-required'`, never as a
   * MISSING row — `zone-quota.test.ts` pins that deliberately. The branch tested `zone2 == null`, so
   * it never fired against real data and a user with no target was told the target was done.
   */
  it('says no target is set when the zone is not-required', () => {
    const r = recommendWalkPattern(quota({ status: 'not-required', targetMin: 0 }))
    expect(r.pattern).toBe(WALK_PATTERNS.easy_steps)
    expect(r.reason).toContain('No Zone 2 target set')
  })

  it('still says the target is done when it was set and met', () => {
    const r = recommendWalkPattern(quota({ status: 'complete', targetMin: 60, doneMin: 60 }))
    expect(r.pattern).toBe(WALK_PATTERNS.easy_steps)
    expect(r.reason).toContain('Zone 2 is done')
  })

  /** The shape the old branch was written for still works, even though nothing produces it. */
  it('says no target is set when the zone is absent entirely', () => {
    expect(recommendWalkPattern(quota(null)).reason).toContain('No Zone 2 target set')
  })

  /** Controls: the thresholds themselves must not move. 15 and 45 are the two boundaries. */
  it.each([
    [15, WALK_PATTERNS.short_intervals],
    [44, WALK_PATTERNS.short_intervals],
    [45, WALK_PATTERNS.long_intervals],
  ])('an open gap of %i minutes still selects the same pattern', (remainingMin, pattern) => {
    const r = recommendWalkPattern(quota({ status: 'open', targetMin: 60, remainingMin }))
    expect(r.pattern).toBe(pattern)
    expect(r.reason).toContain('Zone 2 still open')
  })
})
