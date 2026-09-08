/**
 * What one vial can still do (OR-102b ①②).
 *
 * The mg↔units arithmetic itself is NOT here — it is `@trainingai/shared/health/vial-dose`, shipped
 * with the storage in OR-102a, and duplicating it is this repo's most repeated bug class. This adds
 * only the two questions the calculator screen asks that the ratio alone cannot answer: how many
 * doses are left, and whether the draw fits in the barrel.
 */

import { concentrationMgPerMl, unitsForMg, type Reconstitution } from '@trainingai/shared/health/vial-dose'

/** A syringe's capacity in the same units its barrel is marked in. */
export const DEFAULT_BARREL_UNITS = 100

export interface DosePlan {
  /** Millilitres to draw, or null when the vial or the dose cannot describe one. */
  ml: number | null
  /** Marks on the barrel to draw to. */
  units: number | null
  /** mg per mL, the number the other two are derived from — shown, not just used. */
  concentration: number | null
  /**
   * Whole doses this size the vial holds, from its total mg. Deliberately from mg and not from
   * volume: the substance is what runs out, and the water is chosen by whoever mixed it.
   */
  dosesInVial: number | null
  /** True when one dose needs more than the barrel holds, so it cannot be drawn in one go. */
  exceedsBarrel: boolean
}

export function planDose(
  doseMg: number,
  vial: Reconstitution,
  barrelUnits: number = DEFAULT_BARREL_UNITS,
): DosePlan {
  const concentration = concentrationMgPerMl(vial)
  const units = unitsForMg(doseMg, vial)
  const ml = concentration == null || !Number.isFinite(doseMg) || doseMg < 0 ? null : doseMg / concentration
  // A zero dose is arithmetically fine and divides to Infinity here, which is not a count.
  const dosesInVial =
    concentration == null || !Number.isFinite(doseMg) || doseMg <= 0
      ? null
      : Math.floor(vial.strengthMg / doseMg)
  return {
    ml,
    units,
    concentration,
    dosesInVial,
    exceedsBarrel: units != null && Number.isFinite(barrelUnits) && barrelUnits > 0 && units > barrelUnits,
  }
}

/** `10 mg ÷ 3 mL = 3.33 mg/mL` — the division shown, because the result alone cannot be checked. */
export function concentrationWorking(vial: Reconstitution): string | null {
  const c = concentrationMgPerMl(vial)
  if (c == null) return null
  return `${trim(vial.strengthMg)} mg ÷ ${trim(vial.waterMl)} mL = ${trim(c, 2)} mg/mL`
}

/** `0.5 mg ÷ 3.33 mg/mL = 0.15 mL → 15 units` — the same, for the dose. */
export function doseWorking(doseMg: number, vial: Reconstitution): string | null {
  const plan = planDose(doseMg, vial)
  if (plan.concentration == null || plan.ml == null || plan.units == null) return null
  return `${trim(doseMg, 2)} mg ÷ ${trim(plan.concentration, 2)} mg/mL = ${trim(plan.ml, 2)} mL → ${trim(plan.units)} units`
}

/** Trailing zeros make a dose look more precise than it is; `3.30 mg/mL` reads as measured. */
function trim(n: number, maxDp = 2): string {
  return Number(n.toFixed(maxDp)).toString()
}

/**
 * Whether a mg→syringe-units conversion means anything for this supplement.
 *
 * Whether something is injected is not a field on `supplements`, and the vial that would settle it
 * is a per-supplement fetch a list must not make once per row. A milligram dose is the honest
 * available proxy: it is the set the conversion is defined for, and a mg supplement that is not
 * injected simply carries a control nobody opens.
 */
export function isMilligramDosed(s: { unit?: string | null }): boolean {
  return (s.unit ?? '').trim().toLowerCase() === 'mg'
}
