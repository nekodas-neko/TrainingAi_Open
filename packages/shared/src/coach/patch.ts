import { z } from 'zod';
import { goalBoundSchema } from '@trainingai/shared/validation/goal-bounds';
export const COACH_PATCH_DOMAINS = [
  'session_exercise',
  'nutrition_targets',
  'user_goals',
  'injury',
  'program_phase',
  'early_deload',
  'lift_preference',
] as const;
export type CoachPatchDomain = (typeof COACH_PATCH_DOMAINS)[number];
export const DOMAIN_FIELDS: Record<CoachPatchDomain, readonly string[]> = {
  session_exercise: [
    'exerciseName',
    'styleId',
    'position',
    'removed',
    'newExerciseMuscles',
    'newExerciseEquipment',
  ],
  nutrition_targets: ['calories', 'proteinG', 'carbsG', 'fatG'],
  user_goals: ['stepsGoal', 'calorieGoal', 'waterGoalMl'],
  injury: ['muscleName', 'severity', 'notes', 'resolved'],
  program_phase: ['phaseSetId', 'sessionsPerCycle', 'phaseMode'],
  early_deload: ['deloadNow'],
  lift_preference: ['repRange', 'restSec', 'nextLoadStep', 'setsDelta'],
};
export const DOMAIN_TIER: Record<CoachPatchDomain, 1 | 2 | 3> = {
  user_goals: 1,
  nutrition_targets: 1,
  session_exercise: 2,
  injury: 2,
  early_deload: 2,
  lift_preference: 2,
  program_phase: 3,
};

/**
 * #3896 step 5: patch domains a client must say it can render before the server offers them. An app
 * build parses every proposal against its own copy of `CoachPatchSchema`, so a build from before a
 * domain existed would fail that parse and show a broken card. The chat request names the gated
 * domains the client renders (`patchDomains`); the server offers only those. A domain listed here is
 * never offered to a client that does not name it.
 */
export const GATED_PATCH_DOMAINS: readonly CoachPatchDomain[] = ['lift_preference'];

/** A lift's rep range as the patch carries it: `"12-15"`, low then high. The bounds (whole numbers,
 *  1-30, low <= high) are checked by the handler, which refuses with a plain message rather than
 *  letting the schema retry the model into a number the person never said. */
export const REP_RANGE_TEXT = /^\d{1,2}-\d{1,2}$/;
/** What the model may ask for instead of naming numbers: code works the range out. */
export const REP_RANGE_REQUESTS = ['more_reps', 'fewer_reps'] as const;
export type RepRangeRequest = (typeof REP_RANGE_REQUESTS)[number];
/** #3896 step 7: the program editor's "Use the program's default", which clears a lift's rep range.
 *  Accepted by the apply path only: the model's schema (`patchChangeSchemaFor`) never offers it, so
 *  the Coach's tool JSON is unchanged and the model cannot clear a range on its own. */
export const REP_RANGE_DEFAULT = 'program_default' as const;

/** How long each lift-preference change lasts. Rep range and rest stay until changed (D2); the load
 *  step and the extra or missing set are the one-shot, for the next workout only. */
export const LIFT_PREFERENCE_DURATION: Record<'repRange' | 'restSec' | 'nextLoadStep' | 'setsDelta', 'from_now_on' | 'next_time'> = {
  repRange: 'from_now_on',
  restSec: 'from_now_on',
  nextLoadStep: 'next_time',
  setsDelta: 'next_time',
};
export const DURATION_LABEL = { from_now_on: 'From now on', next_time: 'Just next time' } as const;
const BASE_PATCH_CHANGES = [

  z.object({
    id: z.string().min(1),
    field: z.literal('exerciseName'),
    from: z.string().min(1),
    to: z.string().min(1),
  }),
  z.object({
    id: z.string().min(1),
    field: z.literal('styleId'),
    from: z.string().uuid().nullable(),
    to: z.string().uuid().nullable(),
  }),
  z.object({
    id: z.string().min(1),
    field: z.literal('newExerciseMuscles'),
    from: z.string().nullable(),
    to: z.string().min(1).max(200),
  }),
  z.object({
    id: z.string().min(1),
    field: z.literal('newExerciseEquipment'),
    from: z.string().nullable(),
    to: z.string().max(120),
  }),
  z.object({
    id: z.string().min(1),
    field: z.literal('position'),
    from: z.number().int().min(0),
    to: z.number().int().min(0),
  }),
  z.object({
    id: z.string().min(1),
    field: z.literal('removed'),
    from: z.boolean(),
    to: z.boolean(),
  }),
  ...(['calories', 'proteinG', 'carbsG', 'fatG', 'stepsGoal', 'waterGoalMl'] as const).map(
    (f) =>
      z.object({
        id: z.string().min(1),
        field: z.literal(f),
        from: goalBoundSchema(f).nullable(),
        to: goalBoundSchema(f),
      }),
  ),
  z.object({
    id: z.string().min(1),
    field: z.literal('calorieGoal'),
    from: goalBoundSchema('calorieGoal').nullable(),
    to: goalBoundSchema('calorieGoal').nullable(),
  }),
  z.object({
    id: z.string().min(1),
    field: z.literal('phaseSetId'),
    from: z.string().uuid().nullable(),
    to: z.string().uuid().nullable(),
  }),
  z.object({
    id: z.string().min(1),
    field: z.literal('sessionsPerCycle'),
    from: z.number().int().min(1).max(60).nullable(),
    to: z.number().int().min(1).max(60),
  }),
  z.object({
    id: z.string().min(1),
    field: z.literal('phaseMode'),
    from: z.enum(['manual', 'automatic', 'ai_dynamic']).nullable(),
    to: z.enum(['manual', 'automatic', 'ai_dynamic']),
  }),
  z.object({
    id: z.string().min(1),
    field: z.literal('muscleName'),
    from: z.string().nullable(),
    to: z.string().min(1).max(60),
  }),
  z.object({
    id: z.string().min(1),
    field: z.literal('severity'),
    from: z.enum(['mild', 'moderate', 'severe']).nullable(),
    to: z.enum(['mild', 'moderate', 'severe']),
  }),
  z.object({
    id: z.string().min(1),
    field: z.literal('notes'),
    from: z.string().nullable(),
    to: z.string().max(300),
  }),
  z.object({
    id: z.string().min(1),
    field: z.literal('resolved'),
    from: z.boolean(),
    to: z.boolean(),
  }),
  z.object({
    id: z.string().min(1),
    field: z.literal('deloadNow'),
    from: z.boolean(),
    to: z.boolean(),
  }),
] as const;
/** #3896 step 5: the lift_preference variants, kept apart so a scope that does not offer the domain
 *  can build its `changes` union without them (`patchChangeSchemaFor`). */
const repRangeChange = <T extends z.ZodType<string>>(to: T) =>
  z.object({
    id: z.string().min(1),
    field: z.literal('repRange'),
    from: z.string().regex(REP_RANGE_TEXT).nullable(),
    to,
  }).strict();
/**
 * #4056. A set more or a set fewer, next time. Two schemas from one list of values:
 *
 * - `SETS_DELTA` is the strict rule — exactly -1 or 1. It is what a client parses, what the apply
 *   path checks and what is stored (`exercise_preferences.sets_delta`).
 * - `SETS_DELTA_FOR_MODEL` is what the `proposeChange` tool's input schema carries. The strict
 *   union becomes a JSON `enum` of numbers, and Gemini accepts `enum` only on strings: it refused
 *   every request that offered `lift_preference` with HTTP 400. So the model is shown an integer
 *   (the AI SDK converts a schema's INPUT side, `io: "input"`) and the pipe runs the strict rule on
 *   what it sends back, so a 0, a 2 or a "1" is refused exactly as any invalid proposal is.
 */
const SETS_DELTA_VALUES = [-1, 1] as const;
const SETS_DELTA = z.union([z.literal(SETS_DELTA_VALUES[0]), z.literal(SETS_DELTA_VALUES[1])]);
const SETS_DELTA_FOR_MODEL = z
  .number()
  .int()
  .min(Math.min(...SETS_DELTA_VALUES))
  .max(Math.max(...SETS_DELTA_VALUES))
  .describe(`${SETS_DELTA_VALUES.join(' or ')}, never 0`)
  .pipe(SETS_DELTA);
const setsDeltaChange = (delta: typeof SETS_DELTA | typeof SETS_DELTA_FOR_MODEL) =>
  z.object({
    id: z.string().min(1),
    field: z.literal('setsDelta'),
    from: delta.nullable(),
    to: delta,
  }).strict();
const OTHER_LIFT_PREFERENCE_CHANGES = [
  z.object({
    id: z.string().min(1),
    field: z.literal('restSec'),
    from: z.number().int().min(0).max(3600).nullable(),
    to: z.number().int().min(0).max(3600),
  }).strict(),
  z.object({
    id: z.string().min(1),
    field: z.literal('nextLoadStep'),
    from: z.enum(['lighter', 'heavier']).nullable(),
    to: z.enum(['lighter', 'heavier']),
  }).strict(),
] as const;
// #3896 step 5, the lift_preference domain. Strict: a model that adds a weight, a % or a set count
// to one of these is refused, not ignored — no number the model wrote beyond these reaches the
// write. `from` is only ever compared with the stored row, never written.
const LIFT_PREFERENCE_CHANGES = [
  repRangeChange(z.union([z.string().regex(REP_RANGE_TEXT), z.enum(REP_RANGE_REQUESTS)])),
  ...OTHER_LIFT_PREFERENCE_CHANGES,
  setsDeltaChange(SETS_DELTA_FOR_MODEL),
] as const;
/** The same, plus the editor's clear (`REP_RANGE_DEFAULT`), for the patch a client applies. */
const APPLIED_LIFT_PREFERENCE_CHANGES = [
  repRangeChange(z.union([z.string().regex(REP_RANGE_TEXT), z.enum(REP_RANGE_REQUESTS), z.literal(REP_RANGE_DEFAULT)])),
  ...OTHER_LIFT_PREFERENCE_CHANGES,
  setsDeltaChange(SETS_DELTA),
] as const;
export const PatchChangeSchema = z.discriminatedUnion('field', [...BASE_PATCH_CHANGES, ...APPLIED_LIFT_PREFERENCE_CHANGES]);
/**
 * The change union a scope hands the model. Without `lift_preference` it is built from the same
 * variants `main` had, so the tool JSON of a client that never declares the domain does not grow.
 */
export function patchChangeSchemaFor(withLiftPreference: boolean) {
  return withLiftPreference
    ? z.discriminatedUnion('field', [...BASE_PATCH_CHANGES, ...LIFT_PREFERENCE_CHANGES])
    : z.discriminatedUnion('field', [...BASE_PATCH_CHANGES]);
}
export type PatchChange = z.infer<typeof PatchChangeSchema>;
export const CoachPatchSchema = z.object({
  domain: z.enum(COACH_PATCH_DOMAINS),
  targetId: z.string().uuid().nullable(),
  changes: z.array(PatchChangeSchema).min(1).max(8),
});
export type CoachPatch = z.infer<typeof CoachPatchSchema>;
export const FIELD_LABEL: Record<PatchChange['field'], string> = {
  exerciseName: 'Exercise',
  styleId: 'Progression style',
  position: 'Order',
  removed: 'Remove from session',
  newExerciseMuscles: 'New exercise trains',
  newExerciseEquipment: 'New exercise equipment',
  calories: 'Calories',
  proteinG: 'Protein',
  carbsG: 'Carbs',
  fatG: 'Fat',
  stepsGoal: 'Steps goal',
  calorieGoal: 'Own calorie target',
  waterGoalMl: 'Water goal',
  muscleName: 'Area',
  severity: 'Severity',
  notes: 'Note',
  resolved: 'Mark recovered',
  phaseSetId: 'Periodisation model',
  sessionsPerCycle: 'Sessions per cycle',
  phaseMode: 'Phase mode',
  deloadNow: 'Deload week',
  repRange: 'Rep range',
  restSec: 'Rest between sets',
  nextLoadStep: 'Weight next time',
  setsDelta: 'Sets next time',
};
export const FIELD_UNIT: Partial<Record<PatchChange['field'], string>> = {
  calories: ' kcal',
  calorieGoal: ' kcal',
  proteinG: 'g',
  carbsG: 'g',
  fatG: 'g',
  waterGoalMl: ' ml',
};
/** How a lift-preference value reads on the card: `"12-15"` → "12–15 reps", 90 → "90 s". */
export function liftPreferenceValueLabel(field: PatchChange['field'], value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (field === 'repRange') {
    if (value === 'more_reps') return 'More reps';
    if (value === 'fewer_reps') return 'Fewer reps';
    if (value === REP_RANGE_DEFAULT) return 'The program’s default reps';
    return typeof value === 'string' ? `${value.replace('-', '–')} reps` : null;
  }
  if (field === 'restSec') return typeof value === 'number' ? `${value} s` : null;
  if (field === 'nextLoadStep') return value === 'lighter' ? 'One plate lighter' : value === 'heavier' ? 'One plate heavier' : null;
  if (field === 'setsDelta') return value === 1 ? 'One more set' : value === -1 ? 'One fewer set' : null;
  return null;
}
/** One change the preview worked out in code: a relative rep request (`more_reps`) as the range it
 *  means for this person right now. The card shows it, and Apply carries it instead of the word. */
export interface ResolvedChange { changeId: string; to: string }
/**
 * The patch an Apply sends: each change the preview resolved carries the resolved value, so what is
 * stored is the range the card showed, never a relative word worked out again later.
 */
export function withResolvedChanges(patch: CoachPatch, resolved: readonly ResolvedChange[] | undefined): CoachPatch {
  if (!resolved || resolved.length === 0) return patch;
  const byId = new Map(resolved.map((r) => [r.changeId, r.to]));
  return {
    ...patch,
    changes: patch.changes.map((c) => {
      const to = byId.get(c.id);
      return c.field === 'repRange' && to !== undefined ? { ...c, to } : c;
    }),
  };
}
export function fieldsMatchDomain(patch: CoachPatch): boolean {
  const allowed = DOMAIN_FIELDS[patch.domain];
  return patch.changes.every((c) => allowed.includes(c.field));
}
export function hasUniqueChangeIds(patch: CoachPatch): boolean {
  return new Set(patch.changes.map((c) => c.id)).size === patch.changes.length;
}
