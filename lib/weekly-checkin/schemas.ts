/**
 * #3890 step 2: the request bodies of the weekly check-in routes. Strict: an unknown key is a 400, so no
 * field the engine does not name can ride along. Every id is a uuid and is ownership-checked by the
 * engine before use; `where` is user text, bounded as the column is (1-200 characters).
 */
import { z } from 'zod'
import { CHECKIN_ANSWERS } from '@trainingai/shared/weekly-checkin/effects'
import { normalizeDateParamIso } from '@trainingai/shared/date-utils'
import { MIN_PRESET_BUDGET_MIN } from '@trainingai/shared/workout/duration-model'

// A real calendar date in either separator, as the dash form the week keys use (`normalizeDateParamIso`).
const day = z.string().regex(/^\d{4}[-/]\d{2}[-/]\d{2}$/)
  .transform(v => normalizeDateParamIso(v))
  .refine((v): v is string => v != null)
const id = z.string().uuid()

export const SaveBodySchema = z.object({
  weekStart: day,
  lifts: z.array(z.object({ sessionExerciseId: id, answer: z.enum(CHECKIN_ANSWERS) }).strict()).max(20),
  pain: z.union([
    z.null(),
    z.literal(false),
    z.object({ sessionExerciseId: id, where: z.string().trim().min(1).max(200).nullable() }).strict(),
  ]),
  swap: z.object({ sessionExerciseId: id }).strict().nullable(),
  daysOff: z.array(z.number().int().min(1).max(7)).max(7).nullable(),
  /** The shortest a numeric session-length choice may ask for (`MIN_PRESET_BUDGET_MIN`) to the CHECK's 240. */
  shorterSessionMin: z.number().int().min(MIN_PRESET_BUDGET_MIN).max(240).nullable(),
}).strict()

export const DismissBodySchema = z.object({ weekStart: day }).strict()

export const OfferBodySchema = z.object({
  checkinId: id,
  decision: z.enum(['accept', 'decline']),
  offer: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('step_up'), liftId: id }).strict(),
    z.object({
      kind: z.literal('pain'),
      muscleName: z.string().min(1).max(60).optional(),
      severity: z.enum(['mild', 'moderate', 'severe']).optional(),
    }).strict(),
    z.object({ kind: z.literal('swap'), toExerciseId: id.optional() }).strict(),
  ]),
}).strict()

export const UndoBodySchema = z.object({
  checkinId: id,
  target: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('lift'), liftId: id }).strict(),
    z.object({ kind: z.literal('pain') }).strict(),
    z.object({ kind: z.literal('swap') }).strict(),
    z.object({ kind: z.literal('days_off') }).strict(),
    z.object({ kind: z.literal('shorter_session') }).strict(),
  ]),
}).strict()
