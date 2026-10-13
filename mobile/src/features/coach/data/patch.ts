import { z } from 'zod';
import { goalBoundSchema } from '@trainingai/shared/validation/goal-bounds';

export const COACH_PATCH_DOMAINS = [
  'session_exercise',
  'nutrition_targets',
  'user_goals',
  'injury',
  'program_phase',
  'early_deload',
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
};

export const DOMAIN_TIER: Record<CoachPatchDomain, 1 | 2 | 3> = {
  user_goals: 1,
  nutrition_targets: 1,
  session_exercise: 2,
  injury: 2,
  early_deload: 2,
  program_phase: 3,
};

export const PatchChangeSchema = z.discriminatedUnion('field', [
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
]);
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
};

export const FIELD_UNIT: Partial<Record<PatchChange['field'], string>> = {
  calories: ' kcal',
  calorieGoal: ' kcal',
  proteinG: 'g',
  carbsG: 'g',
  fatG: 'g',
  waterGoalMl: ' ml',
};

export function fieldsMatchDomain(patch: CoachPatch): boolean {
  const allowed = DOMAIN_FIELDS[patch.domain];
  return patch.changes.every((c) => allowed.includes(c.field));
}

export function hasUniqueChangeIds(patch: CoachPatch): boolean {
  return new Set(patch.changes.map((c) => c.id)).size === patch.changes.length;
}
