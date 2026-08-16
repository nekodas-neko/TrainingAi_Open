import { z } from 'zod'

/**
 * Domains AI Coach may write.
 *
 * Every one of these is a **scalar field change** on purpose, even the ones that are conceptually
 * a create. Logging an injury is `bodyPart: — → left shoulder`, `severity: — → moderate`; a phase
 * change is `phase: Hypertrophy → Strength`. Keeping every domain in that one shape means the
 * confirmation UI, the per-row toggles, the staleness check and the undo record are written once
 * rather than per domain — and a new domain is a case in a switch, not a new screen.
 *
 * The write path per domain lives in `applyCoachPatch`; nothing here reaches the database.
 */
export const COACH_PATCH_DOMAINS = [
  'session_exercise',
  'nutrition_targets',
  'user_goals',
  'injury',
  'program_phase',
  'early_deload',
] as const
export type CoachPatchDomain = (typeof COACH_PATCH_DOMAINS)[number]

/** Which fields each domain accepts. The apply path rejects a field outside its domain's list, so
 *  a model that mixes domains cannot write a calorie goal onto an exercise row. */
export const DOMAIN_FIELDS: Record<CoachPatchDomain, readonly string[]> = {
  session_exercise: ['exerciseName', 'styleId', 'position', 'removed', 'newExerciseMuscles', 'newExerciseEquipment'],
  nutrition_targets: ['calories', 'proteinG', 'carbsG', 'fatG'],
  user_goals: ['stepsGoal', 'calorieGoal', 'waterGoalMl'],
  injury: ['muscleName', 'severity', 'notes', 'resolved'],
  program_phase: ['phaseSetId', 'sessionsPerCycle', 'phaseMode'],
  early_deload: ['deloadNow'],
}

/**
 * How heavy a confirmation each domain earns.
 *
 * Tier 1–2 confirm inline in the thread. **Tier 3 pushes a full screen with hold-to-confirm**,
 * because it is the only tier whose effects can take something away — changing the cycle length or
 * the phase set can move you backwards through a block you have already earned, and a list that
 * says so deserves more room than a card in a scrolling conversation.
 */
export const DOMAIN_TIER: Record<CoachPatchDomain, 1 | 2 | 3> = {
  user_goals: 1,
  nutrition_targets: 1,
  session_exercise: 2,
  injury: 2,
  early_deload: 2,
  program_phase: 3,
}

/**
 * A single field change, carrying its own `id` so the user can accept some rows and decline
 * others, and its `from` so the server can refuse a patch whose base has moved.
 *
 * `from` is not decorative and must not be dropped as redundant: it is the only thing that
 * distinguishes "apply this change" from "force this value regardless of what happened since".
 * A proposal can sit in the thread across a program edit in another tab or a completed workout
 * that regenerated the prescription.
 *
 * Deliberately absent: sets, reps, percentage and rest. Those are NOT columns on
 * `session_exercises` (see `lib/data/postgres/schema.ts:115`) — they come from the exercise's
 * progression style (`style_sets`) or the AI prescription overlay, and changing them is a
 * different write with a different owner. The Phase 1 plan listed them under this domain; that
 * was wrong about the schema. Swapping the style is how this domain moves them.
 */
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
  // ── creating the exercise being swapped TO ────────────────────────────────────
  // Present only when `exerciseName.to` names something not in the catalogue. They ride in the
  // same patch rather than a separate `exercise_library` domain so the user gets ONE confirmation
  // showing both halves: what is being created, and what it replaces. Splitting them would mean
  // confirming a catalogue row in isolation, which is not a thing anyone wants to think about.
  //
  // The muscles matter and are not cosmetic — they drive deload weighting, muscle recovery and
  // volume ACWR. A model authoring them is exactly why they are a visible, rejectable row in the
  // confirmation rather than something inferred silently at apply time.
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
    // Plain booleans, not `z.literal(false)` / `z.literal(true)`. A Zod literal compiles to a
    // single-value enum, and Gemini's function-declaration schema only accepts **string** enums —
    // a boolean one is rejected outright with `Invalid value at
    // 'tools[0].function_declarations[…].enum[0]' (TYPE_STRING), true`, which arrives as a masked
    // mid-stream error part rather than an HTTP failure. `to` must still be true to mean anything;
    // that is enforced in `applyCoachPatch` where it can produce a readable message.
    from: z.boolean(),
    to: z.boolean(),
  }),

  // ── nutrition_targets and user_goals ──────────────────────────────────────────
  // Numeric, and bounded. The upper bounds are not decoration: this is the one place a model's
  // number reaches a stored goal, and "set my calories to 26000" should be refused by the schema
  // rather than survive to a confirmation card that looks legitimate.
  ...(['calories', 'proteinG', 'carbsG', 'fatG', 'stepsGoal', 'calorieGoal', 'waterGoalMl'] as const).map(
    f => z.object({
      id: z.string().min(1),
      field: z.literal(f),
      from: z.number().min(0).max(100_000).nullable(),
      to: z.number().min(0).max(100_000),
    }),
  ),

  // ── program_phase (tier 3) ────────────────────────────────────────────────────
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

  // ── injury ────────────────────────────────────────────────────────────────────
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

  // ── early_deload ──────────────────────────────────────────────────────────────
  // A boolean, not the start date, deliberately. The only sensible start is *today*, and which day
  // "today" is depends on the user's timezone — which the server knows and the model does not.
  // Letting a model author the date would put a UTC-flavoured guess into a stored column, the exact
  // bug CLAUDE.md's timezone rule exists to prevent. `false` cancels a deload already running.
  z.object({
    id: z.string().min(1),
    field: z.literal('deloadNow'),
    from: z.boolean(),
    to: z.boolean(),
  }),
])
export type PatchChange = z.infer<typeof PatchChangeSchema>

/**
 * `targetId` is a uuid for domains that patch an existing row, and **null** for the ones that
 * either create (a new injury) or address a singleton the user already owns (their nutrition
 * targets, their goals). A uuid-or-null is honest about that difference; forcing a placeholder
 * uuid would have made "create" and "update someone else's row" look identical to the apply path.
 */
export const CoachPatchSchema = z.object({
  domain: z.enum(COACH_PATCH_DOMAINS),
  targetId: z.string().uuid().nullable(),
  changes: z.array(PatchChangeSchema).min(1).max(8),
})
export type CoachPatch = z.infer<typeof CoachPatchSchema>

/** Human label for a field, used by the preview and the applied-changes history. */
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
  calorieGoal: 'Calorie goal',
  waterGoalMl: 'Water goal',
  muscleName: 'Area',
  severity: 'Severity',
  notes: 'Note',
  resolved: 'Mark recovered',
  phaseSetId: 'Periodisation model',
  sessionsPerCycle: 'Sessions per cycle',
  phaseMode: 'Phase mode',
  deloadNow: 'Deload week',
}

/** Unit suffix for display. Kept beside the labels so a number never renders bare. */
export const FIELD_UNIT: Partial<Record<PatchChange['field'], string>> = {
  calories: ' kcal',
  calorieGoal: ' kcal',
  proteinG: 'g',
  carbsG: 'g',
  fatG: 'g',
  waterGoalMl: ' ml',
}

/** True when every change belongs to the patch's own domain. A model that mixes domains would
 *  otherwise be able to aim a calorie field at an exercise row. */
export function fieldsMatchDomain(patch: CoachPatch): boolean {
  const allowed = DOMAIN_FIELDS[patch.domain]
  return patch.changes.every(c => allowed.includes(c.field))
}

/** Change ids must be unique within a patch or a toggle would resolve to two rows. */
export function hasUniqueChangeIds(patch: CoachPatch): boolean {
  return new Set(patch.changes.map(c => c.id)).size === patch.changes.length
}
