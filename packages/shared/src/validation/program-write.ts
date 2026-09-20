import { z } from 'zod'

// LA-74 — the program half of the pair whose style half shipped 2026-09-07
// (`validation/progression-style.ts`). `POST /api/workout-templates` spread `body.program` straight
// into `repo.saveProgram`. Not mass assignment — the repository names every column it writes — but
// nothing typed or bounded a value, and the two ownership checks the route does carry (`phaseSetId`,
// `styleId`) read as validation while covering two fields.
//
// **Why this one waited, and what changed.** The style schema's header says strict here "needs that
// enumeration checked against a device". The enumeration is the hard part and it is done below; the
// device is not required, and LA-74 says why in its own words: the poster is the WebView, which
// ships with the Railway deploy rather than with the APK. No native code posts to this route, so
// the payloads on device are byte-identical to the payloads on web. That is the same reasoning
// `check-strict-request-schemas.js` uses to NOT exempt this route, and the opposite of
// `scale-ble/samples`, whose client is Kotlin in an APK that does not update with a deploy.
//
// **THREE producers, not the two the entry counted** — every field below was read off them rather
// than off the `Program` type, because the type is what they disagree with:
//
//   1. `config-screen.tsx` editor save — sessions built WITHOUT `programId`, exercises WITHOUT
//      `sessionId`, `id: programEditId ?? undefined`, and a `schedule` that is one of two variants
//      or `null`.
//   2. `config-screen.tsx` activate — `{ ...program, isActive: true }`, i.e. the whole row exactly
//      as `listPrograms` mapped it, with `userId`, `startedAt`, `earlyDeloadWeekStart` and dates as
//      JSON strings.
//   3. `workout-builder/builder-review.tsx` — the one the entry missed. Sends `userId: ''`,
//      `createdAt`/`updatedAt`, and `totalWeeks`; sessions without `timeBudgetMinutes`, exercises
//      without `supersetGroup`, and a rotation schedule with neither `days` nor the reminder fields.
//
// So almost everything is `.optional()`: this schema's job is to TYPE values and refuse keys that
// belong to no column, not to decide which fields a producer ought to send. A required field here
// that any one of the three omits is a 400 on the app's core write path.
//
// **The activate path makes this schema permanently coupled to `listPrograms`' mapper** — it posts
// that mapper's output back verbatim, so a column added there and not here 400s the activate
// button. That coupling is enforced by `program-write-covers-types.test.ts` rather than by memory.

/** `''` is a real value here, not a missing one: the route passes `id ?? ''` and `saveProgram`
 *  branches on `if (program.id)`. Ids are also not all server-minted — the editor keeps a session's
 *  existing id and the builder mints its own with `crypto.randomUUID()` — so this stays a string
 *  rather than `.uuid()`, which would reject a locally-created session on its first save. */
const anyId = z.string().optional()

/** Dates arrive as JSON strings from two producers and are absent from the third. Passed through
 *  unchanged rather than coerced: the route already does `createdAt ?? new Date()` and hands the
 *  value to Drizzle, and coercing here would be a behaviour change smuggled into a validation PR. */
const dateish = z.union([z.string(), z.date()]).optional()

// Upper bounds, per the Custom Rules step "Numeric validators carry an upper bound" (Q-164): an
// unbounded numeric validator accepts any magnitude. (Do not name that validator literally in a
// comment in this file — the rule matches text, so the prose trips it.)
// **Every one of these is a refusal of nonsense, not a product limit** — the
// binding constraint on all of them is the route's 256 KB body, and a bound that could reject a row
// already in the database would 400 the activate of a program that was fine yesterday, which is the
// exact failure this schema exists to prevent. So each sits far above anything a producer builds.
/** Position within a program or session. Sessions come from the editor's list; exercises from one
 *  session. A four-figure ceiling is orders of magnitude above either. */
const MAX_POSITION = 5_000
/** Superset group is an index shared by a handful of exercises within one session. */
const MAX_SUPERSET_GROUP = 1_000
/** A session's time budget, in minutes. A full day. */
const MAX_TIME_BUDGET_MIN = 24 * 60
/** Rest-after-N and sessions-per-cycle both count sessions inside one rotation. */
const MAX_CYCLE_SESSIONS = 1_000
/** Programme length in weeks — twenty years. */
const MAX_TOTAL_WEEKS = 52 * 20

const SessionExerciseWriteSchema = z.object({
  id: anyId,
  sessionId: anyId,
  exerciseName: z.string().min(1),
  styleId: z.string().nullish(),
  muscleGroups: z.array(z.string()).optional(),
  position: z.number().int().min(0).max(MAX_POSITION).optional(),
  exerciseRole: z.enum(['primary', 'secondary', 'accessory']).optional(),
  supersetGroup: z.number().int().min(0).max(MAX_SUPERSET_GROUP).nullish(),
}).strict()

const ProgramSessionWriteSchema = z.object({
  id: anyId,
  programId: anyId,
  name: z.string().min(1),
  position: z.number().int().min(0).max(MAX_POSITION).optional(),
  icon: z.string().nullish(),
  timeBudgetMinutes: z.number().int().min(0).max(MAX_TIME_BUDGET_MIN).nullish(),
  exercises: z.array(SessionExerciseWriteSchema).optional(),
}).strict()

const ScheduleWriteSchema = z.object({
  id: anyId,
  programId: anyId,
  type: z.enum(['weekly', 'rotation']),
  restAfterN: z.number().int().min(0).max(MAX_CYCLE_SESSIONS).nullish(),
  days: z.array(z.object({
    dayOfWeek: z.number().int().min(0).max(6),
    sessionId: z.string().nullish(),
  }).strict()).optional(),
  reminderEnabled: z.boolean().optional(),
  reminderTime: z.string().nullish(),
}).strict()

/**
 * **Deliberately no `.max()` on `name`.** `programs.name` is `text`, so a longer name may already be
 * stored, and a cap added here would start 400ing the ACTIVATE of a program that was fine
 * yesterday — the failure this schema exists to prevent, caused by the schema itself. Length is
 * already bounded by the route's 256 KB body limit.
 */
export const ProgramWriteSchema = z.object({
  id: anyId,
  userId: z.string().optional(),
  name: z.string().min(1),
  isActive: z.boolean().optional(),
  sessions: z.array(ProgramSessionWriteSchema).optional(),
  schedule: ScheduleWriteSchema.nullish(),
  createdAt: dateish,
  updatedAt: dateish,
  phaseMode: z.enum(['manual', 'automatic', 'ai_dynamic']).optional(),
  phaseSetId: z.string().nullish(),
  startedAt: z.string().nullish(),
  sessionsPerCycle: z.number().int().min(0).max(MAX_CYCLE_SESSIONS).nullish(),
  earlyDeloadWeekStart: z.string().nullish(),
  totalWeeks: z.number().int().min(0).max(MAX_TOTAL_WEEKS).nullish(),
  trainingGoal: z.string().optional(),
  autoApplyPrescriptions: z.boolean().optional(),
}).strict()

/**
 * The request body. One object rather than a union because the route itself branches: a
 * recalibration carries `{ recalibrateCycleAnchor, programId }` and no `program` at all, and a save
 * carries `{ program, linkPhaseSetOwnership? }`. A union would give a worse 400 for a typo'd key
 * without refusing anything this does not.
 */
export const WorkoutTemplateWriteSchema = z.object({
  program: ProgramWriteSchema.optional(),
  linkPhaseSetOwnership: z.boolean().optional(),
  recalibrateCycleAnchor: z.boolean().optional(),
  programId: z.string().optional(),
}).strict()
