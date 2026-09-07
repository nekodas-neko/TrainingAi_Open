/**
 * What kit a lifter has, and whether an exercise needs only kit they have.
 *
 * **Extracted because it was three byte-identical copies** — `app/api/generate-program/route.ts`,
 * `app/api/builder-chat/route.ts` and `components/workout-builder/builder-review.tsx` — and BF-129
 * had to change the eligibility half in all of them. Two implementations of one rule is a bug by
 * definition; three that decide whether a lifter is offered an exercise they cannot perform is a
 * bug with a symptom.
 */

/** The catalogue's closed set, expanded from the `full_gym` shorthand the builder sends. */
const ALL_EQUIPMENT = ['barbell', 'dumbbell', 'cable', 'kettlebell', 'machine', 'bodyweight']

/**
 * The equipment a selection grants. `bodyweight` is always present — it is the floor, not a choice:
 * everyone can do a push-up, whatever they ticked.
 */
export function buildEquipmentSet(selected: string[]): Set<string> {
  const set = new Set<string>(['bodyweight'])
  const grants = selected.includes('full_gym') ? ALL_EQUIPMENT : selected
  grants.forEach(e => set.add(e))
  return set
}

/**
 * Whether this exercise needs only kit the lifter has.
 *
 * **An exercise that declares NO equipment is excluded, not passed** (BF-129). Every call site used
 * to read `equipment.length === 0 || equipment.some(...)`, so a catalogue row that had simply never
 * been labelled cleared every equipment selection anyone could make — which is how a home gym with
 * no machines was offered Machine Chest Press. Migration 269 labelled the 22 rows that had drifted
 * and `POST /api/exercises` now refuses to create another, so an empty list should not occur; if one
 * does, excluding is the safe direction, because an exercise the lifter cannot perform is worse than
 * one they never see.
 *
 * The TIME model is deliberately not aligned with this: `transitionSecForEquipment([])` still
 * charges the barbell worst case. Re-tuning that constant is LA-65's, on evidence this does not have.
 */
export function equipmentEligible(exerciseEquipment: string[], owned: Set<string>): boolean {
  return exerciseEquipment.some(e => owned.has(e.toLowerCase()))
}
