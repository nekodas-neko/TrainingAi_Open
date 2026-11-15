/**
 * The split a NEW generated program gets, by training days per week (#3751).
 *
 * This table used to live in the `/api/generate-program` prompt, and the model was asked to copy
 * it. It copied it loosely: names came back as "Push Day (Chest/Shoulders/Triceps)" and code had no
 * way to know which session was meant to be which. Code now owns the split and the names, and the
 * model only fills each session with exercises.
 *
 * These are **default names for a program that does not exist yet**, not a lookup of a user's
 * sessions. Once the program is saved, a session's identity is its DB id, and the user can rename
 * it freely; nothing reads these names back.
 *
 * The order is the order the sessions run in, so it is chosen so that list neighbours do not lead
 * with the same muscles (Upper / Lower alternate; Push, Pull, Legs rotate). Whether neighbours
 * actually share muscles is then checked against the exercises the model picked, in
 * `program-check.ts`, because the plan says what a session should lead with and only the result
 * says what it does.
 */

export interface SplitSession {
  /** The session's default name. */
  name: string
  /** What the session should lead with, in words the prompt can hand to the model. */
  focus: string
  /** The session trains every large muscle, so its neighbours share muscles by design (#3840). */
  fullBody?: true
}

const FULL_BODY = 'every large muscle: chest, back, quads, hamstrings and glutes, with some shoulder and arm work'
const PUSH = 'chest, shoulders and triceps'
const PULL = 'back (lats and upper back), biceps and rear shoulders'
const LEGS = 'quads, hamstrings, glutes and calves'

const SPLITS: Record<number, SplitSession[]> = {
  1: [{ name: 'Full Body', focus: FULL_BODY, fullBody: true }],
  2: [
    { name: 'Full Body A', focus: FULL_BODY, fullBody: true },
    { name: 'Full Body B', focus: `${FULL_BODY}, using different exercises from Full Body A`, fullBody: true },
  ],
  3: [
    { name: 'Push', focus: PUSH },
    { name: 'Pull', focus: PULL },
    { name: 'Legs', focus: LEGS },
  ],
  4: [
    { name: 'Upper Push', focus: 'chest and shoulders first, then back and arms' },
    { name: 'Lower Squat', focus: 'quads first (squat pattern), then glutes, hamstrings and calves' },
    { name: 'Upper Pull', focus: 'back first, then chest, shoulders and arms' },
    { name: 'Lower Hinge', focus: 'hamstrings and glutes first (hinge pattern), then quads and calves' },
  ],
  5: [
    { name: 'Push', focus: PUSH },
    { name: 'Pull', focus: PULL },
    { name: 'Legs', focus: LEGS },
    { name: 'Upper', focus: 'chest, back, shoulders and arms' },
    { name: 'Lower', focus: LEGS },
  ],
  6: [
    { name: 'Push A', focus: PUSH },
    { name: 'Pull A', focus: PULL },
    { name: 'Legs A', focus: LEGS },
    { name: 'Push B', focus: `${PUSH}, using different exercises from Push A` },
    { name: 'Pull B', focus: `${PULL}, using different exercises from Pull A` },
    { name: 'Legs B', focus: `${LEGS}, using different exercises from Legs A` },
  ],
  7: [
    { name: 'Push A', focus: PUSH },
    { name: 'Pull A', focus: PULL },
    { name: 'Legs A', focus: LEGS },
    { name: 'Push B', focus: `${PUSH}, using different exercises from Push A` },
    { name: 'Pull B', focus: `${PULL}, using different exercises from Pull A` },
    { name: 'Legs B', focus: `${LEGS}, using different exercises from Legs A` },
    { name: 'Arms', focus: 'biceps, triceps, forearms and shoulders' },
  ],
}

/** The split for this many training days a week, clamped to the 1–7 the builder offers. */
export function splitForDays(daysPerWeek: number): SplitSession[] {
  const days = Math.min(7, Math.max(1, Math.round(daysPerWeek)))
  return SPLITS[days].map(s => ({ ...s }))
}
