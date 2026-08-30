// Body-composition panel derived from the weight + body-fat% the user already logs
// (body_metrics.weight_kg / body_fat_pct) — no bioimpedance hardware needed. These are the
// *actionable* body-comp metrics; the muscle/bone/water split (Oura's `atlas` model) is the only
// bioimpedance-only part we can't reproduce, and is less useful for training.
//
// BMR uses the Cunningham equation — the SAME formula Oura's `atlas` postprocessor uses
// (bmr = ffm·21.6 + 370). One-Formula-One-Place: this is the only body-comp/BMR derivation for the
// Oura program; a nutrition-goal BMR estimate lives separately in lib/nutrition (different purpose).

export interface BodyComposition {
  /** Fat mass in kg = weight · bodyFat%. */
  fatMassKg: number
  /** Fat-free (lean) mass in kg = weight − fat mass. */
  ffmKg: number
  /** Basal metabolic rate (kcal/day), Cunningham: ffm·21.6 + 370. */
  bmrKcal: number
}

/**
 * Cunningham basal metabolic rate (kcal/day) from fat-free mass (kg): `ffm·21.6 + 370`.
 * The single source of this formula — `atlas_2_1_0`'s postprocessor and the nutrition-goal
 * baseline (`lib/nutrition/goal-recommendation.ts`) both import it (One-Formula-One-Place).
 */
export const cunninghamBmr = (ffmKg: number): number => ffmKg * 21.6 + 370

/** A resting metabolic rate measured clinically (indirect calorimetry), with the body it was
 *  measured on. The fat-free mass is what makes it re-usable later — see `personalRmr`. */
export interface MeasuredRmr {
  rmrKcal: number
  /** Fat-free mass on the day of the test, kg. Null when the provider reported no composition. */
  ffmKgAtTest: number | null
}

/**
 * The person's RMR at their CURRENT fat-free mass, given a clinical measurement taken at some
 * earlier one. Returns `null` when there is nothing better than the prediction.
 *
 * ## Why re-scaling and not an expiry date
 *
 * A measurement has to age somehow: an RMR measured at 71 kg is not the RMR at 78 kg, and a stale
 * number silently outranking a live estimate is worse than having no measurement. The obvious rule
 * is a validity window — trust it for N months, then discard. That fails at both ends: it keeps a
 * measurement at full weight the day before it expires and throws away all of its information the
 * day after, and the thing that actually invalidates it is a change in body composition, which has
 * no fixed relationship to elapsed time. Someone weight-stable for two years has a better
 * measurement than someone who gained 8 kg in three months.
 *
 * Cunningham is linear in fat-free mass (`ffm·21.6 + 370`), so a measurement carries exactly one
 * piece of information the prediction does not: **this person's residual from it.** Keep that and
 * re-apply it at today's fat-free mass. The measurement then ages by how much the body changed
 * rather than by the calendar, degrades smoothly instead of falling off a cliff, and a second test
 * later simply supplies a better residual.
 *
 * Without a fat-free mass from the test there is no residual to compute, so the raw measurement is
 * returned unchanged — it is still better than a prediction, and pretending to re-scale it would be
 * inventing precision that was never measured.
 */
export function personalRmr(measured: MeasuredRmr | null | undefined, currentFfmKg: number | null | undefined): number | null {
  if (measured == null) return null
  if (!Number.isFinite(measured.rmrKcal) || measured.rmrKcal <= 0) return null
  if (measured.ffmKgAtTest == null || currentFfmKg == null) return measured.rmrKcal
  if (!Number.isFinite(measured.ffmKgAtTest) || !Number.isFinite(currentFfmKg)) return measured.rmrKcal
  if (measured.ffmKgAtTest <= 0 || currentFfmKg <= 0) return measured.rmrKcal
  const residual = measured.rmrKcal - cunninghamBmr(measured.ffmKgAtTest)
  return cunninghamBmr(currentFfmKg) + residual
}

/**
 * The band a body-fat percentage must fall in to be treated as a *measurement* rather than a
 * misread. Below the floor is under the essential-fat minimum (ACSM puts it at 2–5% for men,
 * 10–13% for women) and outside anything a consumer bioimpedance scale should be trusted to
 * report; the ceiling matches the scale estimator's own upper clamp.
 *
 * **The floor sits deliberately ABOVE `lib/scale-ble/composition.ts`'s `clamp(…, 3, 60)`.** A
 * no-contact weigh-in (socks, dry feet) makes the scale report impedance 0, which drives the
 * impedance term to −∞ and lands the estimate on that 3% floor — a clamped value that is
 * indistinguishable from a measured one by the time it reaches storage. `hasValidImpedance`
 * already refuses those at both scale routes, and has held for every reading since; this band is
 * the last line before a stored BMR, and it covers the sources that guard cannot see —
 * Health Connect, a manual entry, a second scale.
 *
 * A genuine sub-4% athlete is rejected too. That is the accepted cost and it is small: the
 * *reading* still stands in `body_metrics`, and only the derived snapshot is withheld, so nothing
 * is lost — the panel says "needs a body-fat reading" instead of showing a fabricated one.
 */
export const PLAUSIBLE_BODY_FAT_PCT = { min: 4, max: 60 } as const

export function isPlausibleBodyFatPct(bodyFatPct: number): boolean {
  return bodyFatPct >= PLAUSIBLE_BODY_FAT_PCT.min && bodyFatPct <= PLAUSIBLE_BODY_FAT_PCT.max
}

/**
 * Derive the body-composition panel from a weight (kg) and body-fat percentage.
 * Returns `null` for missing or implausible inputs (never fabricates) — callers render "needs a
 * body-fat reading" rather than a wrong number. See `PLAUSIBLE_BODY_FAT_PCT` for what counts.
 */
export function bodyComposition(weightKg: number | null | undefined, bodyFatPct: number | null | undefined): BodyComposition | null {
  if (weightKg == null || bodyFatPct == null) return null
  if (!Number.isFinite(weightKg) || !Number.isFinite(bodyFatPct)) return null
  if (weightKg <= 0 || !isPlausibleBodyFatPct(bodyFatPct)) return null
  const fatMassKg = weightKg * (bodyFatPct / 100)
  const ffmKg = weightKg - fatMassKg
  const bmrKcal = cunninghamBmr(ffmKg)
  return { fatMassKg, ffmKg, bmrKcal }
}

/** The completed-form `oura_daily_derived.body_comp` JSONB snapshot (Sub-plan F §6.1): the two
 *  source inputs plus the three derived values, rounded for storage. `null` when not derivable. */
export interface BodyCompSnapshot {
  weight_kg: number
  body_fat_pct: number
  fat_mass_kg: number
  ffm_kg: number
  bmr_kcal: number
  source: 'derived'
}

const round1 = (x: number) => Math.round(x * 10) / 10

export function bodyCompSnapshot(
  weightKg: number | null | undefined,
  bodyFatPct: number | null | undefined,
): BodyCompSnapshot | null {
  const comp = bodyComposition(weightKg, bodyFatPct)
  if (comp == null) return null
  return {
    weight_kg: round1(weightKg as number),
    body_fat_pct: round1(bodyFatPct as number),
    fat_mass_kg: round1(comp.fatMassKg),
    ffm_kg: round1(comp.ffmKg),
    bmr_kcal: Math.round(comp.bmrKcal),
    source: 'derived',
  }
}
