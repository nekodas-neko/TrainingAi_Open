import { z } from 'zod'

// Q-484: `POST /api/supplements` accepted a 300,002-character name and a 100,000-character dose and
// stored both in full, while `PATCH /api/supplements/[id]` beside it bounded the same fields at 200.
// Same shape as the injuries pair, same cause — the create route was written without a schema and
// never revisited when the edit route got one.
const FIELDS = {
  name:            z.string().min(1).max(200),
  dose:            z.string().max(200).nullable(),
  // BF-3 — the structured form of the dose. Bounded rather than open: a dose is a quantity of a
  // substance, and 1e6 of any unit is a typo rather than a reading. `unit` is free text on purpose
  // (mg, ml, IU, scoops, capsules) — an enum here would refuse whatever the next substance uses.
  defaultAmount:   z.number().min(0).max(1_000_000).nullable(),
  unit:            z.string().max(20).nullable(),
  reminderEnabled: z.boolean(),
  reminderTime:    z.string().max(20).nullable(),
  sortOrder:       z.number().int().min(0).max(10_000),
  active:          z.boolean(),
}

export const SupplementPatchSchema = z.object({
  name:            FIELDS.name.optional(),
  dose:            FIELDS.dose.optional(),
  defaultAmount:   FIELDS.defaultAmount.optional(),
  unit:            FIELDS.unit.optional(),
  reminderEnabled: FIELDS.reminderEnabled.optional(),
  reminderTime:    FIELDS.reminderTime.optional(),
  sortOrder:       FIELDS.sortOrder.optional(),
  active:          FIELDS.active.optional(),
}).strict() // reject unknown keys (userId/deletedAt/createdAt) outright

/** Only `name` is required; the route defaults the rest, so they keep the PATCH bounds as optional. */
export const SupplementCreateSchema = z.object({
  name:            FIELDS.name,
  dose:            FIELDS.dose.optional(),
  defaultAmount:   FIELDS.defaultAmount.optional(),
  unit:            FIELDS.unit.optional(),
  reminderEnabled: FIELDS.reminderEnabled.optional(),
  reminderTime:    FIELDS.reminderTime.optional(),
  sortOrder:       FIELDS.sortOrder.optional(),
  active:          FIELDS.active.optional(),
}).strict()

/**
 * What `POST /api/supplements/[id]/log` may carry (BF-3).
 *
 * **Every field optional, and the whole body optional**, because the installed APK sends none — it
 * posts an empty request. An older client must keep logging, and it does: the repository stamps the
 * definition's current dose when nothing is supplied, which is the right answer for a log written
 * now and the wrong one only for a mutation queued before a titration. That case is closed by the
 * sync engine filling the payload from the local row, not by making this required.
 */
export const SupplementLogSchema = z.object({
  amount:   FIELDS.defaultAmount.optional(),
  unit:     FIELDS.unit.optional(),
  doseText: FIELDS.dose.optional(),
}).strict()
