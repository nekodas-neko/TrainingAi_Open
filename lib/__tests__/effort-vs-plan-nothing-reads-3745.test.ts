// #3745, NOTHING READS THE ANSWER YET.
//
// The after-the-last-set answer ("easier / as expected / harder than expected", stored as
// exercise_logs.effort_vs_plan and effort_source) is asked, kept on the phone, uploaded, stored and
// pulled. It must not move a prescription, a score or a Coach prompt until the session read (#3889)
// is built in a later batch. This pins that: every source file that names the answer is listed
// here with what it does with it. On the server and in shared code, next to the prescription,
// scoring and Coach code, each line that names it is pinned exactly; elsewhere, how many lines do.
// Any new mention, in a listed file or not, fails this test until someone decides, on #3889, that
// it may read it.
import { describe, it, expect } from 'vitest'
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const NAMES = /effortVsPlan|effort_vs_plan|effortSource|effort_source|EffortVsPlan|ExerciseEffort|effort-vs-plan|answerEffort|effortAsk|effortUntil|effortAnswer|effortQuestion|effortShown|showEffort|vsPlan/

/** A carrier: why it only carries the answer, and its lines that name it (exactly, or how many). */
type Carrier = { why: string; lines: string[] | number }

/** Every non-test source file allowed to name the answer. Regenerate a pin only with a reason. */
const CARRIERS: Record<string, Carrier> = {
  'packages/shared/src/workout/effort-vs-plan.ts': {
    why: 'the values, their schema and labels',
    lines: [
      '* last set. Stored as the answer itself on `exercise_logs.effort_vs_plan` / `effort_source`',
      'export type EffortVsPlan = (typeof EFFORT_VS_PLAN_VALUES)[number];',
      'export const DEFAULT_EFFORT_VS_PLAN: EffortVsPlan = 0;',
      'export const EffortVsPlanSchema = z.union([z.literal(-1), z.literal(0), z.literal(1)]);',
      'export const ExerciseEffortSchema = z.object({',
      'vsPlan: EffortVsPlanSchema,',
      'export type ExerciseEffort = z.infer<typeof ExerciseEffortSchema>;',
      'export const EFFORT_VS_PLAN_LABELS: Record<EffortVsPlan, string> = {',
    ],
  },
  'lib/data/postgres/migrations/202611200539_exercise_log_effort_vs_plan.sql': { why: 'the columns (#3922)', lines: 11 },
  'lib/data/postgres/schema.ts': {
    why: 'the Drizzle columns',
    lines: [
      '// expected, +1 harder; NULL where the question was not shown. `effort_source` is \'tapped\' or',
      'effortVsPlan:         smallint(\'effort_vs_plan\'),',
      'effortSource:         text(\'effort_source\').$type<\'tapped\' | \'default\'>(),',
    ],
  },
  'lib/data/postgres/claude-ro-views.sql': {
    why: 'the read-only view lists every column',
    lines: [
      't.effort_vs_plan,',
      't.effort_source',
    ],
  },
  'packages/shared/src/types/log.ts': {
    why: 'the write shape of an exercise log',
    lines: [
      'import type { EffortSource, EffortVsPlan } from \'../workout/effort-vs-plan\'',
      'effortVsPlan?: EffortVsPlan | null',
      'effortSource?: EffortSource | null',
    ],
  },
  'packages/shared/src/workout/log-payload.ts': {
    why: 'the upload schema accepts it',
    lines: [
      'import { ExerciseEffortSchema } from \'./effort-vs-plan\';',
      'effort:               ExerciseEffortSchema.optional(),',
    ],
  },
  'packages/shared/src/workout/log-exercise-core.ts': {
    why: 'passes it to the write',
    lines: [
      'effortVsPlan: effort?.vsPlan ?? null,',
      'effortSource: effort?.source ?? null,',
    ],
  },
  'lib/data/postgres/adapter.ts': {
    why: 'writes it (insert / keep-on-replay upsert) and selects it into the sync pull',
    lines: [
      'effortVsPlan: log.effortVsPlan ?? null,',
      'effortSource: log.effortSource ?? null,',
      'effortVsPlan: sql`CASE WHEN EXCLUDED.effort_vs_plan IS NULL THEN ${s.exerciseLogs.effortVsPlan} ELSE EXCLUDED.effort_vs_plan END`,',
      'effortSource: sql`CASE WHEN EXCLUDED.effort_vs_plan IS NULL THEN ${s.exerciseLogs.effortSource} ELSE EXCLUDED.effort_source END`,',
      'effortVsPlan:         s.exerciseLogs.effortVsPlan,',
      'effortSource:         s.exerciseLogs.effortSource,',
    ],
  },
  'lib/data/postgres/slices/session-read.ts': {
    why: 'selects it for the session read (#3893), read only',
    lines: [
      'effortVsPlan: s.exerciseLogs.effortVsPlan,',
      'effortSource: s.exerciseLogs.effortSource,',
      'effortVsPlan: l.effortVsPlan,',
      'effortSource: l.effortSource,',
    ],
  },
  'mobile/src/features/workouts/logging/effort.ts': { why: 'asks, records a tap, marks it seen, builds the upload field', lines: 30 },
  'mobile/src/features/workouts/logging/workout.ts': { why: 'journal schema and the upload payload', lines: 5 },
  'mobile/src/features/workouts/logging/WorkoutJournalStore.ts': { why: 'the tap and seen actions; resets on re-log and swap', lines: 16 },
  'mobile/src/features/workouts/components/EffortQuestion.tsx': { why: 'the question on the rest card', lines: 5 },
  'mobile/src/features/workouts/components/ExerciseSummary.tsx': { why: 'places the question on the rest card', lines: 4 },
  'mobile/src/features/workouts/screens/GuidedWorkoutScreen.tsx': { why: 'wires the tap and the seen mark to the journal', lines: 2 },
  'mobile/src/features/workouts/pip/pip.ts': { why: 'the window buttons map to a tap', lines: 5 },
  'mobile/src/features/workouts/pip/usePictureInPicture.ts': { why: 'sends the window when to ask; marks it seen; routes the tap', lines: 7 },
  'mobile/src/features/workouts/status/workout-status.ts': { why: 'the window payload field, always null there', lines: 1 },
  'mobile/src/integrations/workout-status/types.ts': { why: 'the payload type', lines: 1 },
  'mobile/modules/picture-in-picture/android/src/main/java/expo/modules/pictureinpicture/PipState.kt': { why: 'which buttons the window shows, and the answer selected', lines: 7 },
  'mobile/modules/picture-in-picture/android/src/main/java/expo/modules/pictureinpicture/PictureInPictureModule.kt': { why: 'when the buttons go back', lines: 1 },
}

/**
 * The one reader #3889 decided on (20 Nov: "this issue's session read applies them"): the session
 * read, IN SHADOW (#3893). It is stored beside a plan and counted by an admin replay; nothing that
 * builds or shows a prescription reads its result, which the import pin below holds.
 */
const SHADOW_READERS: Record<string, Carrier> = {
  'packages/shared/src/ai-periodization/session-read.ts': {
    why: 'the session read: a tapped answer moves its band (#3889, 20 Nov)',
    lines: [
      'effort: { vsPlan: number | null; source: string | null } | null',
      'return effort.vsPlan === -1 || effort.vsPlan === 0 || effort.vsPlan === 1 ? effort.vsPlan : null',
      "// Effort per set counts only when the lifter gave it (`'asked'` never reached `set_logs`: #3889 step 2 stored `effort_vs_plan`).",
      'effortVsPlan: number | null',
      'effortSource: string | null',
      'effort: { vsPlan: log.effortVsPlan, source: log.effortSource },',
    ],
  },
}

/** Every non-test file allowed to import the session read while it is in shadow. */
const SESSION_READ_IMPORTERS = [
  'app/api/admin/session-read-replay/route.ts',
  'lib/data/postgres/slices/session-read.ts',
  'lib/data/repository.ts',
  'packages/shared/src/ai-periodization/session-read-plan.ts',
  'packages/shared/src/types/ai-periodization.ts',
  // #3890: the weekly check-in's summary compares the logged sets with the plan through the read's own
  // per-set rule (`classifySet`), keeps the read's verdict as a machine field only, and lets "Heavy" hold
  // a stored read (`holdUnderCheckin`, applied inside session-read-plan.ts); neither builds a
  // prescription. Its one load effect, Heavy plus a missed rep, is `unexcusedMissAtPlan` on the logged
  // sets, never a verdict, so nothing it writes hangs on the shadow read.
  'packages/shared/src/weekly-checkin/effects.ts',
  'packages/shared/src/weekly-checkin/summary.ts',
]

const isTest = (path: string) =>
  /(^|\/)(__tests__|tests|test)\//.test(path) || /\.test\.tsx?$/.test(path) || /Test\.kt$/.test(path)
const isDoc = (path: string) => /\.(md|mdx)$/.test(path) || path.startsWith('docs/')
const naming = (text: string) => text.split('\n').filter(line => NAMES.test(line)).map(line => line.trim())

/** Paths where a reader would be: prescription, progression, scoring, readiness and the Coach. */
const READERS = /ai-periodization|prescription|progression|scor|coach|prompt|autoreg|expected-rpe|1rm|recovery|readiness/i

describe('nothing reads the effort answer yet (#3745, until #3889)', () => {
  // Tracked and new files alike, so a reader added in a working tree fails before it is committed.
  const files = execSync('git ls-files --cached --others --exclude-standard', { encoding: 'utf8' })
    .split('\n')
    .filter(path => /\.(ts|tsx|js|mjs|cjs|kt|sql)$/.test(path) && !isTest(path) && !isDoc(path))
  const named = new Map(
    files.map(path => [path, naming(readFileSync(path, 'utf8'))] as const).filter(([, lines]) => lines.length),
  )

  it('only the carriers and the shadow reader name it, each exactly as pinned', () => {
    const allowed = { ...CARRIERS, ...SHADOW_READERS }
    expect([...named.keys()].filter(path => !(path in allowed))).toEqual([])
    // And the list is not stale: each carrier still names it.
    expect(Object.keys(allowed).filter(path => !named.has(path))).toEqual([])
    for (const [path, { lines }] of Object.entries(allowed)) {
      const found = named.get(path) ?? []
      if (typeof lines === 'number') expect({ path, lines: found.length }).toEqual({ path, lines })
      else expect({ path, lines: found }).toEqual({ path, lines })
    }
  })

  it('catches a reader, and no prescription, score, progression or Coach file is one', () => {
    // The pin sees the way a reader would read it.
    expect(naming('const harderHold = effort?.vsPlan === 1')).toHaveLength(1)
    expect(naming('if (log.effortSource === "tapped") hold()')).toHaveLength(1)
    // There are such files to check, and none of them names the answer.
    const readers = files.filter(path => READERS.test(path))
    expect(readers.length).toBeGreaterThan(20)
    expect(readers.filter(path => named.has(path))).toEqual(Object.keys(SHADOW_READERS))
    expect(Object.keys(CARRIERS).filter(path => READERS.test(path))).toEqual([])
  })

  it('the shadow reader feeds no prescription: only the plan store, the replay and their types import it (#3893)', () => {
    const importers = files.filter(path => /from '[^']*ai-periodization\/session-read'|import\('[^']*ai-periodization\/session-read'\)|from '\.\/session-read'/.test(readFileSync(path, 'utf8')))
    expect(importers.sort()).toEqual([...SESSION_READ_IMPORTERS].sort())
    // Generation only stores the reads it loads; it never imports the rules themselves.
    const gen = readFileSync('packages/shared/src/ai-periodization/generate-prescription.ts', 'utf8')
    expect(gen.match(/sessionReads/g)?.length).toBe(4)
  })
})
