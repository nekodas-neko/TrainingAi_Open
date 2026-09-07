/**
 * Turning milligrams into syringe units, and back (OR-102a).
 *
 * One place, because there are two directions and they must agree: the log screen asks "how many
 * units is this dose", history asks "what dose was that many units", and two implementations of the
 * same ratio disagreeing is this repo's most repeated bug class.
 *
 * **Concentration is derived here and stored nowhere.** `strengthMg / waterMl` is mg per ml. A
 * stored concentration is a third number that can disagree with the two it came from, and the first
 * time it does, nothing says which is right.
 */

/** A reconstitution: what went into the vial, and what barrel measures it out. */
export interface Reconstitution {
  /** Milligrams of substance in the vial before water. */
  strengthMg: number
  /** Millilitres of bacteriostatic water added. */
  waterMl: number
  /** Marks per millilitre on the syringe barrel — 100 for a U-100. Stored, not assumed: a barrel
   *  that is not U-100 is a real possibility and assuming one is a wrong dose. */
  syringeUnitsPerMl: number
}

/**
 * Milligrams per millilitre, or `null` when the inputs cannot describe a vial.
 *
 * Rejects zero and negative water rather than dividing: `strengthMg / 0` is `Infinity`, which
 * propagates silently through every later multiplication and renders as a plausible-looking number
 * rather than an error. A vial with no water is not a very concentrated vial, it is a typo.
 */
export function concentrationMgPerMl(r: Reconstitution): number | null {
  if (!Number.isFinite(r.strengthMg) || !Number.isFinite(r.waterMl)) return null
  if (r.strengthMg <= 0 || r.waterMl <= 0) return null
  return r.strengthMg / r.waterMl
}

/** Syringe units for a dose in milligrams, or `null` when the reconstitution cannot describe one. */
export function unitsForMg(mg: number, r: Reconstitution): number | null {
  const conc = concentrationMgPerMl(r)
  if (conc == null) return null
  if (!Number.isFinite(mg) || mg < 0) return null
  if (!Number.isFinite(r.syringeUnitsPerMl) || r.syringeUnitsPerMl <= 0) return null
  return (mg / conc) * r.syringeUnitsPerMl
}

/** The inverse: milligrams for a number of syringe units. */
export function mgForUnits(units: number, r: Reconstitution): number | null {
  const conc = concentrationMgPerMl(r)
  if (conc == null) return null
  if (!Number.isFinite(units) || units < 0) return null
  if (!Number.isFinite(r.syringeUnitsPerMl) || r.syringeUnitsPerMl <= 0) return null
  return (units / r.syringeUnitsPerMl) * conc
}

/**
 * The reconstitution a log froze, or `null` when it froze none.
 *
 * A log written before OR-102a, or one for a substance that is not injected, has no vial numbers.
 * `null` means "this dose cannot be expressed in units", which is the honest answer — the
 * alternative is falling back to the CURRENT vial, which is exactly the retroactive rewrite the
 * freeze exists to prevent.
 */
export function frozenReconstitution(log: {
  vialStrengthMg?: number | null
  vialWaterMl?: number | null
  vialUnitsPerMl?: number | null
}): Reconstitution | null {
  const { vialStrengthMg: s, vialWaterMl: w, vialUnitsPerMl: u } = log
  if (s == null || w == null || u == null) return null
  return { strengthMg: s, waterMl: w, syringeUnitsPerMl: u }
}
