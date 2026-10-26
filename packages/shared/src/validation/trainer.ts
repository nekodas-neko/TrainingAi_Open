import { z } from 'zod'

// #2300 — request bodies for `/api/trainer/**`. Every object is `.strict()`: a key that belongs to
// no field is refused rather than ignored, and nothing from a body is ever spread into a row.
//
// **The program shape deliberately has no ids at all** — not the program's, a session's, an
// exercise's or a schedule's. The server mints every one. The editor-facing `ProgramWriteSchema`
// accepts client ids because an edit has to keep `workout_sessions.session_id` links alive; a
// trainer assignment only ever creates, and an id supplied by a trainer is exactly the field that
// could point into another account. A schedule day names its session by position in `sessions`
// (`sessionIndex`) instead.
//
// `styleId` is the one reference a trainer supplies. It names a style in the TRAINER's library, is
// verified to be theirs, and is replaced by a copy owned by the trainee (plan §2).
//
// Not accepted, on purpose: `isActive` (an assigned program arrives inactive; the trainee switches
// to it), `phaseMode`/`phaseSetId` (v1 is manual only; phase sets are per-account rows),
// `userId`/`createdAt`/`updatedAt`/`startedAt` (server-owned), reminder fields (a trainer does not
// get to switch notifications on, on someone else's phone) and `autoApplyPrescriptions` (whether the
// AI's prescriptions apply on their own is the trainee's setting, not the trainer's).

/** Ceilings are refusals of nonsense, far above anything the editor builds. */
const MAX_SESSIONS = 50
const MAX_EXERCISES_PER_SESSION = 100
const MAX_POSITION = 5_000
const MAX_TIME_BUDGET_MIN = 24 * 60
const MAX_CYCLE_SESSIONS = 1_000
const MAX_TOTAL_WEEKS = 52 * 20
const MAX_NAME_CHARS = 200

const AssignedExerciseSchema = z.object({
  exerciseName: z.string().trim().min(1).max(MAX_NAME_CHARS),
  styleId: z.string().uuid().nullish(),
  muscleGroups: z.array(z.string().trim().min(1).max(MAX_NAME_CHARS)).max(20).optional(),
  position: z.number().int().min(0).max(MAX_POSITION).optional(),
  exerciseRole: z.enum(['primary', 'secondary', 'accessory']).optional(),
  supersetGroup: z.number().int().min(0).max(1_000).nullish(),
}).strict()

const AssignedSessionSchema = z.object({
  name: z.string().trim().min(1).max(MAX_NAME_CHARS),
  position: z.number().int().min(0).max(MAX_POSITION).optional(),
  icon: z.string().max(MAX_NAME_CHARS).nullish(),
  timeBudgetMinutes: z.number().int().min(0).max(MAX_TIME_BUDGET_MIN).nullish(),
  exercises: z.array(AssignedExerciseSchema).max(MAX_EXERCISES_PER_SESSION),
}).strict()

const AssignedScheduleSchema = z.object({
  type: z.enum(['weekly', 'rotation']),
  restAfterN: z.number().int().min(0).max(MAX_CYCLE_SESSIONS).nullish(),
  days: z.array(z.object({
    dayOfWeek: z.number().int().min(0).max(6),
    sessionIndex: z.number().int().min(0).max(MAX_SESSIONS - 1).nullable(),
  }).strict()).max(7).optional(),
}).strict()

export const AssignProgramBodySchema = z.object({
  program: z.object({
    name: z.string().trim().min(1).max(MAX_NAME_CHARS),
    trainingGoal: z.enum(['strength', 'hypertrophy', 'power', 'endurance']).optional(),
    totalWeeks: z.number().int().min(0).max(MAX_TOTAL_WEEKS).nullish(),
    sessionsPerCycle: z.number().int().min(0).max(MAX_CYCLE_SESSIONS).nullish(),
    sessions: z.array(AssignedSessionSchema).min(1).max(MAX_SESSIONS),
    schedule: AssignedScheduleSchema.nullish(),
  }).strict().superRefine((p, ctx) => {
    for (const [i, d] of (p.schedule?.days ?? []).entries()) {
      if (d.sessionIndex !== null && d.sessionIndex >= p.sessions.length) {
        ctx.addIssue({ code: 'custom', path: ['schedule', 'days', i, 'sessionIndex'], message: 'sessionIndex names no session' })
      }
    }
  }),
}).strict()

export type AssignProgramBody = z.infer<typeof AssignProgramBodySchema>

/** Ask someone to be your trainee: their email or friend code, exactly as typed. */
export const RequestTraineeBodySchema = z.object({
  emailOrCode: z.string().trim().min(1).max(320),
}).strict()

export const RelationshipActionBodySchema = z.object({
  action: z.enum(['accept', 'revoke']),
}).strict()
