/**
 * What one vial can still do (OR-102b ①②).
 *
 * The mg↔units arithmetic itself is NOT here — it is `@trainingai/shared/health/vial-dose`, shipped
 * with the storage in OR-102a, and duplicating it is this repo's most repeated bug class. This adds
 * only the two questions the calculator screen asks that the ratio alone cannot answer: how many
 * doses are left, and whether the draw fits in the barrel.
 */

import { concentrationMgPerMl, unitsForMg, type Reconstitution } from '@trainingai/shared/health/vial-dose'
import { daysBetweenDateStrs } from '@trainingai/shared/date-utils'

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

/** One logged dose of a supplement, as the vial arithmetic below needs it. */
export interface VialDoseLog {
  /** The local day the dose was logged against, YYYY-MM-DD. */
  date: string
  amount: number | null
  unit: string | null
  /** ISO instant the tick stamped, or null for a dose logged before the column existed. */
  takenAt?: string | null
}

/** Where one dose sits in the vial it was drawn from (#2185): the week since mixing, doses left after it. */
export interface VialStanding {
  /** 1 for the first seven days after `openedOn`, 2 for the next seven, and so on. */
  week: number
  /** Whole doses of THIS size the vial still holds once this dose and every earlier one are out. */
  dosesLeft: number
}

/**
 * The vial a dose came from and what was left in it afterwards, for the dose row on Home's
 * timeline. The vial is the newest one mixed on or before the dose's day; every milligram dose
 * logged from that day up to this dose is taken out of its strength. A fact about the user's own
 * logs, never a claim about the body. Null when the dose has no milligram amount or no vial
 * covers its day, and the row then shows its title alone.
 */
export function vialStanding(
  dose: VialDoseLog,
  vials: readonly { strengthMg: number; openedOn: string }[],
  logs: readonly VialDoseLog[],
): VialStanding | null {
  if (!isMilligramDosed(dose) || dose.amount == null || !Number.isFinite(dose.amount) || dose.amount <= 0) return null
  // Newest first by `openedOn`; the first of a tie wins, as `listSupplementVials` orders them.
  let vial: { strengthMg: number; openedOn: string } | null = null
  for (const v of vials) {
    if (v.openedOn <= dose.date && (vial == null || v.openedOn > vial.openedOn)) vial = v
  }
  if (!vial || !(vial.strengthMg > 0)) return null
  const doseAt = dose.takenAt ? Date.parse(dose.takenAt) : NaN
  let usedMg = 0
  for (const log of logs) {
    if (!isMilligramDosed(log) || log.amount == null || !(log.amount > 0)) continue
    if (log.date < vial.openedOn || log.date > dose.date) continue
    // A later dose on the same day has not been drawn yet at this one.
    const at = log.takenAt ? Date.parse(log.takenAt) : NaN
    if (log.date === dose.date && Number.isFinite(at) && Number.isFinite(doseAt) && at > doseAt) continue
    usedMg += log.amount
  }
  // The rounding slack keeps 10 − 20 × 0.5 a clean zero rather than −1e-15.
  const leftMg = vial.strengthMg - usedMg
  return {
    week: Math.floor(daysBetweenDateStrs(vial.openedOn, dose.date) / 7) + 1,
    dosesLeft: Math.max(0, Math.floor(leftMg / dose.amount + 1e-9)),
  }
}

/** The dose row's two lines: "Dose · 2 mg" and "Week 6 of this vial · 3 doses left". */
export function doseTimelineText(
  dose: { amount: number | null; unit: string | null },
  standing: VialStanding | null,
): { title: string; subtitle?: string } {
  const amount = dose.amount != null && Number.isFinite(dose.amount)
    ? [trim(dose.amount, 3), dose.unit?.trim()].filter(Boolean).join(' ')
    : null
  return {
    title: amount ? `Dose · ${amount}` : 'Dose',
    subtitle: standing
      ? `Week ${standing.week} of this vial · ${standing.dosesLeft} ${standing.dosesLeft === 1 ? 'dose' : 'doses'} left`
      : undefined,
  }
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
