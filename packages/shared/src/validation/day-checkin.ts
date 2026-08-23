import { z } from 'zod'

const scale = () => z.number().int().min(1).max(5).nullable().optional()

// The 10 evening/morning wellness scales — shared by the web route
// (app/api/day-checkin/route.ts) and pushMutations so an out-of-range
// outbox payload can never write through unvalidated.
export const DayCheckinScalesSchema = z.object({
  physicalTiredness: scale(),
  mentalDrain:        scale(),
  barelyMoved:         scale(),
  hydration:           scale(),
  lateHeavyMeal:       scale(),
  wakeMood:            scale(),
  perceivedRecovery:   scale(),
  motivation:          scale(),
  sleepQualityFeel:    scale(),
  restingSoreness:     scale(),
})

// journal/soreMuscles bounds — shared by the web route and pushMutations
// (SYNC-P4) so an outbox payload can't write an unbounded journal string or
// non-string soreMuscles entries straight through unvalidated.
export const DayCheckinExtrasSchema = z.object({
  soreMuscles: z.array(z.string()).default([]),
  journal: z.string().max(2000).nullable().optional(),
  // Q-113: replaces `motivation`; touched flags distinguish a genuine self-report from an
  // accepted score-derived prefill on perceivedRecovery/sleepQualityFeel.
  illnessContext: z.enum(['sick', 'alcohol', 'poor_sleep']).nullable().optional(),
  perceivedRecoveryTouched: z.boolean().optional(),
  sleepQualityFeelTouched: z.boolean().optional(),
})

/**
 * The answer columns — the fields that carry what the user actually told us.
 *
 * Deliberately excludes `phase` and `date` (addressing, not answers) and the two `*Touched` flags
 * (metadata about whether a score-derived prefill was accepted — meaningless without the scale they
 * describe).
 */
const ANSWER_SCALES = Object.keys(DayCheckinScalesSchema.shape) as (keyof typeof DayCheckinScalesSchema.shape)[]

/**
 * Does this check-in body say anything at all? (Q-465)
 *
 * `POST /api/day-checkin` with a body of exactly `{}` returned 201 and wrote a row with every metric
 * null. That row is indistinguishable from a real check-in in which the user answered nothing — and
 * readiness is precisely the pillar where *"the user told us nothing"* and *"the user told us they
 * feel neutral"* must not collapse to the same value. It also changes `reevaluationKey(...)` in
 * `/api/workout-data`, so a hollow row can trigger a re-evaluation carrying no new information.
 *
 * **Nothing in real use has done this** — all 50 of the owner's check-in rows carry answers, across
 * every column including the six morning ones. Both live writers always send at least two numeric
 * scales, because their state initialises from `NEUTRAL_SCALES` rather than from null. So this is a
 * guard on a reachable-but-unused path, not a fix for an observed symptom, and it is written to
 * accept everything those writers send.
 *
 * Shared, because the outbox reaches the same table through `pushMutations` — a rule enforced on the
 * two schemas above for exactly the same reason.
 */
export function dayCheckinHasAnswers(body: {
  soreMuscles?: string[] | null
  journal?: string | null
  illnessContext?: string | null
  [key: string]: unknown
}): boolean {
  if (ANSWER_SCALES.some(k => typeof body[k] === 'number')) return true
  if (body.illnessContext != null) return true
  if (typeof body.journal === 'string' && body.journal.trim().length > 0) return true
  if (Array.isArray(body.soreMuscles) && body.soreMuscles.length > 0) return true
  return false
}
