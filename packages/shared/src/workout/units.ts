/**
 * Weight unit conversion — one constant, one place.
 *
 * BF-141. `LBS_TO_KG` lived as a private const in `lib/data/postgres/adapter.ts`, where it was
 * written for the 2026-06-15 repair tool that corrected three dumbbell exercises logged in pounds
 * into the `weight_kg` column. The toggle that stops that happening again needs the same number on
 * the client, and a second copy is how two implementations of one metric start — so it moves here
 * and the adapter imports it.
 *
 * The value is exact by definition, not measured: the international pound has been defined as
 * exactly 0.45359237 kg since 1959. It is not a tuning parameter and has no reason to change.
 */
export const LBS_TO_KG = 0.45359237

/** Pounds → kilograms, exactly. Round for storage at the call site, never here — BF-141's rounding
 *  hazard is that `mround125` clamps to [5, 250], so a 5 lb dumbbell (2.27 kg) would floor to 5 kg
 *  and silently more than double. A conversion that rounded itself would hide that decision. */
export function lbsToKg(lbs: number): number {
  return lbs * LBS_TO_KG
}

/** Kilograms → pounds, exactly. Same rounding rule as above. */
export function kgToLbs(kg: number): number {
  return kg / LBS_TO_KG
}
