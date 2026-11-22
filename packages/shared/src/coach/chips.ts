import { z } from 'zod';

/**
 * The Coach's buttons (#3896 steps 6 and 7, owner's pick 8b A on 22 Nov).
 *
 * **A button is a fixed message and an intent, both defined here, never by the model or the client.**
 * Tapping one sends `message` as the user's turn and `intent` beside it in the request. The server
 * turns the intent into a fixed instruction (`lib/coach/intents.ts`) and refuses an intent that does
 * not fit the ownership-checked context. The model still only proposes; the card's numbers are code's.
 *
 * **Which buttons show is the server's call** (`/api/coach/about`, from the checked context): opened
 * from a lift, the six lift buttons; from anywhere else, the four general ones; the nutrition scope
 * keeps its own. The labels are the design's (#3896, first comment, §3c).
 */
export const COACH_INTENTS = [
  // Opened from one lift.
  'lift_too_heavy',
  'lift_too_light',
  'lift_more_reps',
  'lift_swap',
  'lift_hurt',
  'lift_why_weight',
  // Opened with no lift.
  'change_exercise',
  'felt_heavy_or_light',
  'something_hurts',
] as const;
export type CoachIntent = (typeof COACH_INTENTS)[number];
export const CoachIntentSchema = z.enum(COACH_INTENTS);

export interface CoachChip {
  /** Stable id, for tests and for an entry point's shortcut ("More reps, less weight" in the menu). */
  id: string;
  label: string;
  /** What is sent as the user's message when the button is tapped. */
  message: string;
  /** Null for a button that is only a message (it was a plain starter before). */
  intent: CoachIntent | null;
}
export const CoachChipSchema = z.object({
  id: z.string(),
  label: z.string(),
  message: z.string(),
  intent: CoachIntentSchema.nullable(),
});

/** What each intent needs from the request before the server accepts it. */
export const INTENT_NEEDS: Record<CoachIntent, { lift: boolean; liftPreference: boolean; training: boolean }> = {
  lift_too_heavy: { lift: true, liftPreference: true, training: true },
  lift_too_light: { lift: true, liftPreference: true, training: true },
  lift_more_reps: { lift: true, liftPreference: true, training: true },
  lift_swap: { lift: true, liftPreference: false, training: true },
  lift_hurt: { lift: true, liftPreference: false, training: true },
  lift_why_weight: { lift: true, liftPreference: false, training: true },
  change_exercise: { lift: false, liftPreference: false, training: true },
  felt_heavy_or_light: { lift: false, liftPreference: true, training: true },
  something_hurts: { lift: false, liftPreference: false, training: true },
};

export const LIFT_CHIPS: readonly CoachChip[] = [
  { id: 'too_heavy', label: 'Too heavy', message: 'This lift feels too heavy.', intent: 'lift_too_heavy' },
  { id: 'too_light', label: 'Too light', message: 'This lift feels too light.', intent: 'lift_too_light' },
  { id: 'more_reps', label: 'More reps, less weight', message: 'I want more reps and less weight on this lift.', intent: 'lift_more_reps' },
  { id: 'swap', label: 'Swap this', message: 'I want to swap this lift for another.', intent: 'lift_swap' },
  { id: 'hurt', label: 'It hurt', message: 'This lift hurt.', intent: 'lift_hurt' },
  { id: 'why_weight', label: 'Why this weight?', message: 'Why is this the weight for this lift?', intent: 'lift_why_weight' },
];

export const GENERAL_CHIPS: readonly CoachChip[] = [
  { id: 'change_exercise', label: 'Change an exercise', message: 'I want to change an exercise.', intent: 'change_exercise' },
  { id: 'felt_heavy_or_light', label: 'This felt too heavy / too light', message: 'Something felt too heavy or too light.', intent: 'felt_heavy_or_light' },
  { id: 'something_hurts', label: 'Something hurts', message: 'Something hurts.', intent: 'something_hurts' },
  { id: 'lagging', label: 'What’s lagging?', message: 'What’s lagging?', intent: null },
];

/** The design moves the old food starter to the nutrition scope (§3c). */
export const NUTRITION_CHIPS: readonly CoachChip[] = [
  { id: 'instead_of_rice', label: 'What can I eat instead of rice', message: 'What can I eat instead of rice', intent: null },
];

/** The buttons for a request, from facts the server has checked: whether a lift context resolved,
 *  whether the client renders the lift_preference card, and the scope. */
export function chipsFor(opts: { scope: 'general' | 'nutrition'; lift: boolean; liftPreference: boolean }): CoachChip[] {
  if (opts.scope === 'nutrition') return [...NUTRITION_CHIPS];
  const base = opts.lift ? LIFT_CHIPS : GENERAL_CHIPS;
  return base.filter((chip) => chip.intent === null || opts.liftPreference || !INTENT_NEEDS[chip.intent].liftPreference);
}

/** Whether `intent` may be sent with a request of this shape. The route refuses (400) otherwise. */
export function intentAllowed(intent: CoachIntent, has: { lift: boolean; liftPreference: boolean; training: boolean }): boolean {
  const needs = INTENT_NEEDS[intent];
  if (needs.lift !== has.lift) return false;
  if (needs.liftPreference && !has.liftPreference) return false;
  if (needs.training && !has.training) return false;
  return true;
}

/** `/api/coach/about`'s answer. `about` is the context line (null when the Coach was opened with no
 *  lift, session or workout); every word in it is written by the server from the user's own rows. */
export const CoachAboutSchema = z.object({
  about: z.object({ label: z.string(), line: z.string() }).nullable(),
  chips: z.array(CoachChipSchema),
});
export type CoachAbout = z.infer<typeof CoachAboutSchema>;
