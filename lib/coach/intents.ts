import type { CoachIntent } from '@trainingai/shared/coach/chips'

/**
 * What each Coach button means, as a fixed instruction (#3896 steps 6 and 7). The button's message is
 * the user's turn; this block joins the system prompt for that request only, so the model knows the
 * tap was a button and which tools the app expects. It is code's text: nothing from the client or the
 * model is in it, and the lift it refers to is the one in "Where the user opened you", which the
 * route has already checked belongs to the user.
 *
 * **The model still only proposes.** A lift_preference proposal names an id and an enumerated change;
 * the card's numbers are measured by the preview route. "It hurt" and "Why this weight?" change
 * nothing.
 */
const LIFT = 'the exercise in "Where the user opened you"'
const TARGET = 'targetId set to its session exercise id from that section'

const TEXT: Record<CoachIntent, string> = {
  lift_too_heavy: [
    `The user tapped "Too heavy" for ${LIFT}.`,
    'Call getExerciseContext for it first.',
    'Then, in one sentence, say what its last log shows against the plan. If the rest taken before the',
    'missed sets was well short of the rest planned, say so in that sentence: resting fully is the other fix.',
    `Then call proposeChange in the "lift_preference" domain with ${TARGET} and one change: field`,
    '"nextLoadStep", `to` "lighter", `from` the preference\'s nextLoadStep (null when it has none).',
    'Do not ask a question first. Do not name a weight: the card shows it.',
  ].join('\n'),
  lift_too_light: [
    `The user tapped "Too light" for ${LIFT}.`,
    'Call getExerciseContext for it first, then say in one sentence what its last log shows against the plan.',
    `Then call proposeChange in the "lift_preference" domain with ${TARGET} and one change: field`,
    '"nextLoadStep", `to` "heavier", `from` the preference\'s nextLoadStep (null when it has none).',
    'Do not ask a question first. Do not name a weight: the card shows it.',
  ].join('\n'),
  lift_more_reps: [
    `The user tapped "More reps, less weight" for ${LIFT}.`,
    'Call getExerciseContext for it first.',
    `Then call proposeChange in the "lift_preference" domain with ${TARGET} and one change: field`,
    '"repRange", `to` "more_reps", `from` the preference\'s repRange (null when it has none). The app',
    'works the range and the weight out and shows them on the card. Do not ask a question first.',
  ].join('\n'),
  lift_swap: [
    `The user tapped "Swap this" for ${LIFT}. They have already picked the exercise, so skip that step:`,
    'call renderChoiceList with source "swap_candidates" and sourceId its session exercise id. When they',
    'pick one, call proposeChange in the "session_exercise" domain with an exerciseName change, from → to.',
  ].join('\n'),
  lift_hurt: [
    `The user tapped "It hurt" for ${LIFT}. Follow "Pain and injuries": ask what the pain is like and`,
    'when it started, with a choice list where one fits. Do not propose any change in this reply. Once',
    'you know what it is, offer to log it as an injury; for today only, point to the swap inside the',
    'workout screen.',
  ].join('\n'),
  lift_why_weight: [
    `The user tapped "Why this weight?" for ${LIFT}. Call getExerciseContext for it and explain where`,
    'the next weight comes from, using only numbers in its result and in "Where the user opened you":',
    'the stored plan\'s sets, reps, percentage and weight, and what was planned against done last time.',
    'Never work out, estimate or state a number that is not in those results; if a number is missing,',
    'say it is not recorded. Do not propose a change in this reply.',
  ].join('\n'),
  change_exercise: [
    'The user tapped "Change an exercise". Show the exercises in their program: renderChoiceList with',
    'source "exercises". When they pick one, call getExerciseContext for it, then ask what to change with',
    'one choice list: swap it, more reps and less weight, lighter next time, or heavier next time.',
  ].join('\n'),
  felt_heavy_or_light: [
    'The user tapped "This felt too heavy / too light". Show the exercises in their program:',
    'renderChoiceList with source "exercises". When they pick one, ask "too heavy" or "too light" with one',
    'choice list, then call getExerciseContext for it and propose one plate lighter or heavier for next',
    'time: proposeChange in the "lift_preference" domain, field "nextLoadStep".',
  ].join('\n'),
  something_hurts: [
    'The user tapped "Something hurts". Follow "Pain and injuries": ask which exercise with',
    'renderChoiceList source "exercises", then what the pain is like and when it started. Do not propose',
    'any change in this reply.',
  ].join('\n'),
}

/** The system-prompt block for a button tap. */
export function intentBlock(intent: CoachIntent): string {
  return `## The button the user tapped\nThe user's message is the fixed text of a button in the app.\n${TEXT[intent]}`
}
