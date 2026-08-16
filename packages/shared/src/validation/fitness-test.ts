// lib/validation/fitness-test.ts
// Shared by the web route (app/api/fitness-tests/route.ts) and pushMutations so
// an outbox payload can never write through unvalidated (SYNC-P3 discipline).
import { z } from 'zod'
import { activityImplausibleReason } from './plausibility'

const FitnessTestFields = z.object({
  testType:    z.enum(['6mwt', 'cooper12', 'resting_hrr']),
  // Both separators: the client fills date params from localDateString(), which emits
  // slashes — a dash-only regex rejects every real request before the handler runs (Q-130).
  date:        z.string().regex(/^\d{4}[-/]\d{2}[-/]\d{2}$/),
  durationSec: z.number().int().positive().max(7200).optional(),
  distanceM:   z.number().nonnegative().max(100000).optional(),
  avgHr:       z.number().int().positive().max(250).optional(),
  maxHr:       z.number().int().positive().max(250).optional(),
  restingHr:   z.number().int().positive().max(250).optional(),
  hrr1Bpm:     z.number().int().max(250).optional(),
  vo2maxEst:   z.number().positive().max(100).optional(),
  method:      z.string().max(60).optional(),
  notes:       z.string().max(1000).optional(),
})

/**
 * Cross-field (Q-24 §7): distance and duration were bounded only on their own, so 100,000 m in 1 s
 * passed — a 360,000 km/h walk test whose VO2max estimate then feeds every training zone.
 *
 * The test's own units are converted to the activity shape rather than restating the speed and
 * HR-ordering rules, so both surfaces move together when either bound changes.
 */
function refineFitnessTest(v: z.infer<typeof FitnessTestFields>, ctx: z.RefinementCtx) {
  const reason = activityImplausibleReason({
    durationMin: v.durationSec != null ? v.durationSec / 60 : undefined,
    distanceKm:  v.distanceM   != null ? v.distanceM / 1000 : undefined,
    avgHr: v.avgHr,
    maxHr: v.maxHr,
  })
  if (reason) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Implausible fitness test: ${reason}` })
}

export const FitnessTestBody = FitnessTestFields.superRefine(refineFitnessTest)

// The web route accepts a client-generated id so an offline-first save keeps the same row identity
// across both paths. Built from the same fields + the same refinement rather than `.extend()`ing
// FitnessTestBody, which is a ZodEffects and has no `.extend`.
export const FitnessTestCreateBody = FitnessTestFields
  .extend({ id: z.string().uuid().optional() })
  .superRefine(refineFitnessTest)

export type FitnessTestInput = z.infer<typeof FitnessTestBody>
