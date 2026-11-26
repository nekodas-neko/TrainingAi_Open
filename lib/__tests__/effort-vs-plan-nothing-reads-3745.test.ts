// #3745, WHAT READS THE ANSWER, EXACTLY.
//
// The after-the-last-set answer ("easier / as expected / harder than expected", stored as
// exercise_logs.effort_vs_plan and effort_source) is asked, kept on the phone, uploaded, stored and
// pulled. Since #4061 (owner, 23 Nov: "We will gauge from that instead of rpe") ONE live reader takes
// it: the plan's effort signal, where a tapped Easier or Harder on a lift's latest log stands in for
// that lift's rated RPE (`effortRpeDelta`), and the prompt line that tells the model so. The session
// read (#3889) still reads it in shadow. Nothing else may: no score, no progression, no Coach prompt.
// Since #4159 each SET also carries an answer (`set_logs.effort_vs_plan` / `effort_source`, written by the
// upload and carried to the session read). It is evidence only: no plan, score or note reads it, and the
// server does not derive the lift's answer from the sets. The fourth test pins which files name it.
// This pins that: every source file that names the answer is listed here with what it does with it.
// On the server and in shared code, next to the prescription, scoring and Coach code, each line that
// names it is pinned exactly; elsewhere, how many lines do. Any new mention, in a listed file or not,
// fails this test until someone decides, on an issue, that it may read it.
import { describe, it, expect } from 'vitest'
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const NAMES = /effortVsPlan|effort_vs_plan|effortSource|effort_source|EffortVsPlan|ExerciseEffort|effort-vs-plan|answerEffort|effortAsk|effortUntil|effortAnswer|effortQuestion|effortShown|showEffort|vsPlan|[sS]etEffort/

/** A carrier: why it only carries the answer, and its lines that name it (exactly, or how many). */
type Carrier = { why: string; lines: string[] | number }

/** Every non-test source file allowed to name the answer. Regenerate a pin only with a reason. */
const CARRIERS: Record<string, Carrier> = {
  'packages/shared/src/workout/effort-vs-plan.ts': {
    why: 'the values, their schema (the exercise\'s answer and, strict, one set\'s, #4159) and labels',
    lines: [
      '* last set. Stored as the answer itself on `exercise_logs.effort_vs_plan` / `effort_source`',
      'export type EffortVsPlan = (typeof EFFORT_VS_PLAN_VALUES)[number];',
      'export const DEFAULT_EFFORT_VS_PLAN: EffortVsPlan = 0;',
      'export const EffortVsPlanSchema = z.union([z.literal(-1), z.literal(0), z.literal(1)]);',
      'export const ExerciseEffortSchema = z.object({',
      'vsPlan: EffortVsPlanSchema,',
      'export type ExerciseEffort = z.infer<typeof ExerciseEffortSchema>;',
      'export const SetEffortSchema = ExerciseEffortSchema.strict();',
      'export const EFFORT_VS_PLAN_LABELS: Record<EffortVsPlan, string> = {',
    ],
  },
  'lib/data/postgres/migrations/202611200539_exercise_log_effort_vs_plan.sql': { why: 'the columns (#3922)', lines: 11 },
  'lib/data/postgres/migrations/202611252323_set_log_effort_vs_plan.sql': { why: 'the per-set columns (#4154)', lines: 13 },
  'lib/data/postgres/schema.ts': {
    why: 'the Drizzle columns',
    lines: [
      '// expected, +1 harder; NULL where the question was not shown. `effort_source` is \'tapped\' or',
      'effortVsPlan:         smallint(\'effort_vs_plan\'),',
      'effortSource:         text(\'effort_source\').$type<\'tapped\' | \'default\'>(),',
      '// exercise_logs columns (#3892): -1 easier, 0 as expected, +1 harder; `effort_source` is \'tapped\'',
      'effortVsPlan:  smallint(\'effort_vs_plan\'),',
      'effortSource:  text(\'effort_source\').$type<\'tapped\' | \'default\'>(),',
    ],
  },
  'lib/data/postgres/claude-ro-views.sql': {
    why: 'the read-only view lists every column',
    lines: [
      't.effort_vs_plan,',
      't.effort_source',
      't.effort_vs_plan,',
      't.effort_source',
    ],
  },
  'packages/shared/src/types/log.ts': {
    why: 'the write shape of an exercise log and of a set (#4159)',
    lines: [
      'import type { EffortSource, EffortVsPlan } from \'../workout/effort-vs-plan\'',
      'effortVsPlan?: EffortVsPlan | null',
      'effortSource?: EffortSource | null',
      'effortVsPlan?: EffortVsPlan | null',
      'effortSource?: EffortSource | null',
    ],
  },
  'packages/shared/src/workout/log-payload.ts': {
    why: 'the upload schema accepts it, the exercise\'s and each set\'s (#4159)',
    lines: [
      'import { ExerciseEffortSchema, SetEffortSchema } from \'./effort-vs-plan\';',
      'effort:               ExerciseEffortSchema.optional(),',
      'setEfforts:           z.array(SetEffortSchema.nullable()).max(20).optional(),',
      'if (p.setEfforts && p.setEfforts.length > 0 && p.setEfforts.length !== p.weights.length) {',
      "ctx.addIssue({ code: 'custom', path: ['setEfforts'], message: 'setEfforts must have one entry per set' });",
    ],
  },
  'packages/shared/src/workout/log-exercise-core.ts': {
    why: 'passes it to the write: the exercise\'s answer and each set\'s (#4159), as sent, one never derived from the other',
    lines: [
      'rpeValues, rpeSources, intensityMode, wasOverride, exerciseDeloaded, effort, setEfforts,',
      'effortVsPlan: setEfforts?.[i]?.vsPlan,',
      'effortSource: setEfforts?.[i]?.source,',
      'effortVsPlan: effort?.vsPlan ?? null,',
      'effortSource: effort?.source ?? null,',
    ],
  },
  'lib/workout/exercise-log-edits-core.ts': {
    why: 'clears a set\'s answer when an edit removes the set or brings it back (#4159); never reads or sets one',
    lines: [
      'effort_vs_plan = CASE WHEN set_logs.deleted_at IS NULL THEN set_logs.effort_vs_plan END,',
      'effort_source = CASE WHEN set_logs.deleted_at IS NULL THEN set_logs.effort_source END,',
      '`UPDATE set_logs SET deleted_at = now(), effort_vs_plan = NULL, effort_source = NULL',
    ],
  },
  'lib/data/postgres/adapter.ts': {
    why: 'writes it (insert / keep-on-replay upsert, the exercise\'s and each set\'s), selects it into the sync pull, and routes the plan\'s read (#4061)',
    lines: [
      'effortVsPlan: log.effortVsPlan ?? null,',
      'effortSource: log.effortSource ?? null,',
      'effortVsPlan: sql`CASE WHEN EXCLUDED.effort_vs_plan IS NULL THEN ${s.exerciseLogs.effortVsPlan} ELSE EXCLUDED.effort_vs_plan END`,',
      'effortSource: sql`CASE WHEN EXCLUDED.effort_vs_plan IS NULL THEN ${s.exerciseLogs.effortSource} ELSE EXCLUDED.effort_source END`,',
      // #4159: the per-set pair, written in the set's own insert and keep-on-NULL upsert.
      'effortVsPlan: set.effortVsPlan != null && set.effortSource != null ? set.effortVsPlan : null,',
      'effortSource: set.effortVsPlan != null && set.effortSource != null ? set.effortSource : null,',
      'effortVsPlan: sql`CASE WHEN EXCLUDED.effort_vs_plan IS NULL THEN ${s.setLogs.effortVsPlan} ELSE EXCLUDED.effort_vs_plan END`,',
      'effortSource: sql`CASE WHEN EXCLUDED.effort_vs_plan IS NULL THEN ${s.setLogs.effortSource} ELSE EXCLUDED.effort_source END`,',
      'effortVsPlan:         s.exerciseLogs.effortVsPlan,',
      'effortSource:         s.exerciseLogs.effortSource,',
      // #4166: the set's pair rides the sync pull, carried only.
      'effortVsPlan:  s.setLogs.effortVsPlan,',
      'effortSource:  s.setLogs.effortSource,',
      'async getLatestExerciseEfforts(userId: string, workoutSessionIds: string[], exerciseNames: string[]) { return period.getLatestExerciseEfforts(this.db, userId, workoutSessionIds, exerciseNames) }',
    ],
  },
  'lib/data/postgres/slices/periodization.ts': {
    why: 'selects each lift\'s latest answer for the plan (#4061), read only, owner-scoped',
    lines: [
      'export async function getLatestExerciseEfforts(',
      '): Promise<Map<string, { vsPlan: number | null; source: string | null }>> {',
      'const out = new Map<string, { vsPlan: number | null; source: string | null }>()',
      'SELECT DISTINCT ON (lifts.lift) lifts.lift, el.effort_vs_plan, el.effort_source',
      'for (const r of res.rows as Array<{ lift: string; effort_vs_plan: number | null; effort_source: string | null }>) {',
      'out.set(r.lift, { vsPlan: r.effort_vs_plan == null ? null : Number(r.effort_vs_plan), source: r.effort_source })',
    ],
  },
  'lib/data/repository.ts': {
    why: 'the type of the plan\'s read (#4061)',
    lines: [
      "getLatestExerciseEfforts?(userId: string, workoutSessionIds: string[], exerciseNames: string[]): Promise<Map<string, import('@trainingai/shared/ai-periodization/autoregulation').LatestEffortAnswer>>",
    ],
  },
  'lib/data/postgres/slices/session-read.ts': {
    why: 'selects it, the lift\'s and each set\'s (#4159), for the session read (#3893), read only',
    lines: [
      'effortVsPlan: s.exerciseLogs.effortVsPlan,',
      'effortSource: s.exerciseLogs.effortSource,',
      // #4159: each set's answer, selected beside its reps and weight as evidence; nothing decides on it.
      'setEffortVsPlan: s.setLogs.effortVsPlan,',
      'setEffortSource: s.setLogs.effortSource,',
      'setEffortVsPlan: row.setEffortVsPlan,',
      'setEffortSource: row.setEffortSource,',
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
      // #4159: each set's answer rides on the set (a type, no rule reads it: the third test pins that).
      'setEffortVsPlan?: number | null',
      'setEffortSource?: string | null',
      'effort: { vsPlan: number | null; source: string | null } | null',
      'return effort.vsPlan === -1 || effort.vsPlan === 0 || effort.vsPlan === 1 ? effort.vsPlan : null',
      "// Effort per set counts only when the lifter gave it (`'asked'` never reached `set_logs`: #3889 step 2 stored `effort_vs_plan`).",
      'effortVsPlan: number | null',
      'effortSource: string | null',
      'effort: { vsPlan: log.effortVsPlan, source: log.effortSource },',
    ],
  },
}

/**
 * The live reader #4061 decided on (owner, 23 Nov): a tapped Easier or Harder on a lift's latest log is
 * the plan's effort signal in place of rated RPE, through `computeRpeAdjustment`'s own thresholds; the
 * prompt states it so the model's text agrees with the adjustment code applies after it.
 */
const LIVE_READERS: Record<string, Carrier> = {
  'packages/shared/src/ai-periodization/autoregulation.ts': {
    why: 'the mapping: tapped +1 / -1 onto the rated-RPE delta, everything else no signal (#4061); and the plan note for a tap the rule changed nothing for (#4079)',
    lines: [
      "import type { EffortSource, EffortVsPlan } from '@trainingai/shared/workout/effort-vs-plan'",
      "/** The answer on a lift's latest log, as stored (`exercise_logs.effort_vs_plan` / `effort_source`). */",
      'export interface LatestEffortAnswer { vsPlan: number | null; source: string | null }',
      'export function tappedEffort(latest: LatestEffortAnswer | null | undefined): EffortVsPlan | undefined {',
      'return latest.vsPlan === -1 || latest.vsPlan === 0 || latest.vsPlan === 1 ? latest.vsPlan : undefined',
      'effortAnswer?: -1 | 1',
      "const said = sig.effortAnswer === 1 ? 'harder' : sig.effortAnswer === -1 ? 'easier' : null",
      'if (sig.effortAnswer === 1) {',
    ],
  },
  'packages/shared/src/ai-periodization/signals.ts': {
    why: 'reads each lift\'s latest answer and folds it into the lift\'s rpeDelta (#4061)',
    lines: [
      'effortAnswer?: -1 | 0 | 1',
      'const read = await (async () => repo.getLatestExerciseEfforts?.(userId, last3Ids, exerciseNames))()',
      'const effortAnswer = tappedEffort(latestEfforts.get(ex.name))',
      '...(effortAnswer !== undefined && { effortAnswer }),',
    ],
  },
  'packages/shared/src/ai-periodization/prompt.ts': {
    why: 'states a tapped Easier or Harder under the RPE trend, from the stored value (#4061)',
    lines: [
      "import { EFFORT_VS_PLAN_LABELS } from '@trainingai/shared/workout/effort-vs-plan'",
      'const effortAnswers = signals.exercises',
      '.filter(ex => ex.effortAnswer === 1 || ex.effortAnswer === -1)',
      '.map(ex => `${promptLineName(ex.name)}: ${EFFORT_VS_PLAN_LABELS[ex.effortAnswer!].toLowerCase()}`)',
      'const effortInfo = effortAnswers.length > 0',
      "? `\\nEffort answer (the lifter's tap after the lift's last set, latest session; read in place of RPE for that lift): ${effortAnswers.join('; ')}`",
    ],
  },
  'packages/shared/src/ai-periodization/generate-prescription.ts': {
    why: 'marks the delta as the tap\'s and which way it went, for a note\'s wording only (#4061, #4079)',
    lines: [
      '...(e.effortAnswer !== undefined && { effortFromAnswer: true as const }),',
      '...((e.effortAnswer === 1 || e.effortAnswer === -1) && { effortAnswer: e.effortAnswer }),',
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

describe('exactly these read the effort answer (#3745; live in the plan since #4061)', () => {
  // Tracked and new files alike, so a reader added in a working tree fails before it is committed.
  const files = execSync('git ls-files --cached --others --exclude-standard', { encoding: 'utf8' })
    .split('\n')
    .filter(path => /\.(ts|tsx|js|mjs|cjs|kt|sql)$/.test(path) && !isTest(path) && !isDoc(path))
  const named = new Map(
    files.map(path => [path, naming(readFileSync(path, 'utf8'))] as const).filter(([, lines]) => lines.length),
  )

  it('only the carriers, the live reader and the shadow reader name it, each exactly as pinned', () => {
    const allowed = { ...CARRIERS, ...LIVE_READERS, ...SHADOW_READERS }
    expect([...named.keys()].filter(path => !(path in allowed))).toEqual([])
    // And the list is not stale: each carrier still names it.
    expect(Object.keys(allowed).filter(path => !named.has(path))).toEqual([])
    for (const [path, { lines }] of Object.entries(allowed)) {
      const found = named.get(path) ?? []
      if (typeof lines === 'number') expect({ path, lines: found.length }).toEqual({ path, lines })
      else expect({ path, lines: found }).toEqual({ path, lines })
    }
  })

  it('catches a reader, and no prescription, score, progression or Coach file is one beyond those pinned', () => {
    // The pin sees the way a reader would read it.
    expect(naming('const harderHold = effort?.vsPlan === 1')).toHaveLength(1)
    expect(naming('if (log.effortSource === "tapped") hold()')).toHaveLength(1)
    // There are such files to check, and none of them names the answer.
    const readers = files.filter(path => READERS.test(path))
    expect(readers.length).toBeGreaterThan(20)
    expect(readers.filter(path => named.has(path)).sort()).toEqual([...Object.keys(LIVE_READERS), ...Object.keys(SHADOW_READERS)].sort())
    expect(Object.keys(CARRIERS).filter(path => READERS.test(path))).toEqual([])
  })

  it('a set\'s own answer (#4159) is written by the upload and carried by the session read; no decision names it', () => {
    // Every file that names a set's answer, by any of its names: the schema and write path, and the
    // session read's loader and type. None of them is a prescription, score, progression or Coach file
    // except the session read's type, which is shadow and only holds the field.
    const setNames = /[sS]etEffort/
    const setFiles = files.filter(path => setNames.test(readFileSync(path, 'utf8'))).sort()
    expect(setFiles).toEqual([
      'lib/data/postgres/slices/session-read.ts',
      'packages/shared/src/ai-periodization/session-read.ts',
      'packages/shared/src/workout/effort-vs-plan.ts',
      'packages/shared/src/workout/log-exercise-core.ts',
      'packages/shared/src/workout/log-payload.ts',
    ])
    // The session read's own rules never touch the field: the type declares it and nothing else in the file uses it.
    const read = readFileSync('packages/shared/src/ai-periodization/session-read.ts', 'utf8')
    expect(read.match(/setEffort/g)).toHaveLength(2)
  })

  it('the shadow reader feeds no prescription: only the plan store, the replay and their types import it (#3893)', () => {
    const importers = files.filter(path => /from '[^']*ai-periodization\/session-read'|import\('[^']*ai-periodization\/session-read'\)|from '\.\/session-read'/.test(readFileSync(path, 'utf8')))
    expect(importers.sort()).toEqual([...SESSION_READ_IMPORTERS].sort())
    // Generation only stores the reads it loads; it never imports the rules themselves.
    const gen = readFileSync('packages/shared/src/ai-periodization/generate-prescription.ts', 'utf8')
    expect(gen.match(/sessionReads/g)?.length).toBe(4)
  })
})
