import { z } from 'zod'
import { WEIGHT_KG_MIN, WEIGHT_KG_MAX } from './body-metrics'

/**
 * A JSON number, or a numeric string — and nothing else (Q-495).
 *
 * `z.coerce.number()` runs `Number(v)` on whatever it is given, and `Number()` is generous in ways
 * that produce a *valid-looking* reading rather than an error. Measured against this route:
 * `"steps":[]` stored **0**, `"steps":true` stored **1**, and `"weightKg":""` and `"weightKg":[]`
 * each stored **0 kg** — every one accepted, stamped `health_connect`, and in range for `.min(0)`.
 * The route's own comment was accurate about what it had tested (a stringified `75kg` and a `1e308`
 * double are both still rejected) and silent about these.
 *
 * **Numeric strings are deliberately still accepted.** The obvious fix is a plain number schema with
 * no coercion at all, and it is the one thing here that could break the live integration: Tasker builds this body by string
 * concatenation, so `"steps":"4200"` is a plausible shape for it to send, and there is no way to
 * confirm which from a sandbox. Rejecting `[]`/`true`/`""` closes the measured defect and cannot
 * break a client, so the two are separated rather than bundled.
 */
const ingestNumber = (bounds: z.ZodNumber) =>
  z.preprocess(
    v => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v),
    bounds,
  ).nullable().optional();

export const IngestBodySchema = z.object({
  secret: z.string(),
  // The mirror of the dash-only problem: slash-only here would reject a dashed date from
  // Tasker, which is the one client that fills this (Q-130).
  date: z.string().regex(/^\d{4}[-/]\d{2}[-/]\d{2}$/).optional(),
  // The shared bounds, not a local `.min(0)`: a 0 kg body weight is exactly as much "clearly
  // garbage" as the stringified `75kg` this route already rejects, and it is the value
  // `getMostRecentConfirmedWeightKg` would then serve. `WEIGHT_KG_MIN` is 20.
  //
  // Safe against the owner's live pipeline, checked rather than assumed: production holds 114
  // `body_metrics` rows with **zero** at weight 0, zero under 20 kg, zero at body-fat 0 and zero at
  // steps 0 (min weight 67.55, max 72.8). Tasker omits a field it has no reading for; it does not
  // send 0, so a floor cannot 400 a real push.
  weightKg:   ingestNumber(z.number().min(WEIGHT_KG_MIN).max(WEIGHT_KG_MAX)),
  bodyFat:    ingestNumber(z.number().min(0).max(100)),
  steps:      ingestNumber(z.number().int().min(0).max(200_000)),
  calories:   ingestNumber(z.number().min(0).max(20_000)),
  protein:    ingestNumber(z.number().min(0).max(2_000)),
  carb:       ingestNumber(z.number().min(0).max(2_000)),
  fat:        ingestNumber(z.number().min(0).max(2_000)),
  distanceKm: ingestNumber(z.number().min(0).max(500)),
});

