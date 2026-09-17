import { z } from 'zod'

/**
 * The bounds a mood check-in must satisfy, wherever it enters the system.
 *
 * `POST /api/mood` has parsed these since it was written; the offline `pushMutations` branch
 * that mirrors it parsed **nothing** — it cast straight through (`p.energyLevel as EnergyLevel`),
 * so an arbitrary string reached the `NOT NULL` `energy_level` column and every readiness and
 * energy surface then rendered it as a real check-in (Q-131). Every sibling domain got a shared
 * schema under SYNC-P3/P4/Q-24; mood was missed. Sharing one schema is what stops the two paths
 * drifting again.
 *
 * `sleepQuality` is optional on both paths on purpose: the check-in no longer collects it, so a
 * queued mutation omits it and the write path defaults to `'ok'` — without that default the
 * `NOT NULL` column rejects the insert and the mutation strands in the outbox forever, which is
 * how the check-in came back on every app open (#47).
 */
export const MoodFieldsSchema = z.object({
  energyLevel:  z.enum(['drained', 'low', 'ok', 'good', 'pumped']),
  sleepQuality: z.enum(['terrible', 'poor', 'ok', 'good', 'great']).optional(),
  bodyState: z.array(z.enum([
    'feeling_good', 'stiff', 'sore_muscles', 'sick', 'tired_legs',
    'joint_pain', 'tight_back', 'low_motivation',
  ])).max(20).optional(),
  soreMuscles: z.array(z.string().max(40)).max(30).optional(),
  /** Which of `soreMuscles` the check-in sheet pre-selected, as opposed to the lifter ticking it
   *  himself (BF-173 / LB-116). Optional: `saveMoodLog` derives it when a caller omits it, so an
   *  older client keeps working — the derivation is a fallback, not the source of truth, because it
   *  cannot distinguish a volunteered muscle that would also have qualified, and for a queued
   *  offline write it runs against a recovery feed from hours later. Without this key here the
   *  field is silently stripped: the schema has no `.strict()`, so Zod drops unknowns rather than
   *  rejecting them, and the sheet's value would never reach the route or the outbox. */
  suggestedSoreMuscles: z.array(z.string().max(40)).max(30).optional(),
})

export type MoodFields = z.infer<typeof MoodFieldsSchema>
