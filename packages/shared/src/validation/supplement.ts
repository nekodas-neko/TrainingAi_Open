import { z } from 'zod'

// Q-484: `POST /api/supplements` accepted a 300,002-character name and a 100,000-character dose and
// stored both in full, while `PATCH /api/supplements/[id]` beside it bounded the same fields at 200.
// Same shape as the injuries pair, same cause — the create route was written without a schema and
// never revisited when the edit route got one.
const FIELDS = {
  name:            z.string().min(1).max(200),
  dose:            z.string().max(200).nullable(),
  reminderEnabled: z.boolean(),
  reminderTime:    z.string().max(20).nullable(),
  sortOrder:       z.number().int().min(0).max(10_000),
  active:          z.boolean(),
}

export const SupplementPatchSchema = z.object({
  name:            FIELDS.name.optional(),
  dose:            FIELDS.dose.optional(),
  reminderEnabled: FIELDS.reminderEnabled.optional(),
  reminderTime:    FIELDS.reminderTime.optional(),
  sortOrder:       FIELDS.sortOrder.optional(),
  active:          FIELDS.active.optional(),
}).strict() // reject unknown keys (userId/deletedAt/createdAt) outright

/** Only `name` is required; the route defaults the rest, so they keep the PATCH bounds as optional. */
export const SupplementCreateSchema = z.object({
  name:            FIELDS.name,
  dose:            FIELDS.dose.optional(),
  reminderEnabled: FIELDS.reminderEnabled.optional(),
  reminderTime:    FIELDS.reminderTime.optional(),
  sortOrder:       FIELDS.sortOrder.optional(),
  active:          FIELDS.active.optional(),
}).strict()
