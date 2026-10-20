import {
  V2_LADDERS, STEPS_UNITS_PER_T1, STEPS_DRAIN_PER_DAY, HEALTH_POINTS_PER_T1, HEALTH_DRAIN_PER_DAY,
  CARDIO_UNITS_PER_SESSION, CARDIO_UNITS_PER_T1, CARDIO_DRAIN_PER_DAY,
} from './ladder'

/** A run of a rule's text: plain, the bold lead-in, or the one phrase set apart in the last rule. */
export type RuleSegment = { text: string; style?: 'lead' | 'em' }
export type RulePara = RuleSegment[]

const n = (value: number) => value.toLocaleString('en-AU')

/**
 * "How this works", in plain words. Every number is read from the engine's own constants rather than
 * typed out, so the page cannot drift from the fold that produces it — and both apps draw the same
 * paragraphs from here.
 */
export function collectionRules(): RulePara[] {
  const { workout, steps, health, cardio } = V2_LADDERS
  const lead = (text: string): RuleSegment => ({ text, style: 'lead' })
  return [
    [
      lead(`Four rows, ${workout.tiers.length} tiers each.`),
      { text: ` Every workout you do gives the Tank row a ${workout.tiers[0].name}. Steps, health logging and cardio sessions fill a bank that turns into ${steps.tiers[0].name}, ${health.tiers[0].name} and ${cardio.tiers[0].name} cats.` },
    ],
    [
      lead('They merge upward.'),
      { text: ` ${workout.tiers.slice(1).map(t => t.mergeCost).join(' · ')} cats of one tier make the next on the Tank row. On the other three rows it is ${steps.tiers[1].mergeCost} of one tier for one of the next, all the way up.` },
    ],
    [
      lead('Steps.'),
      { text: ` ${n(STEPS_UNITS_PER_T1)} steps in a day make a ${steps.tiers[0].name}. Each day the bank drains ${n(STEPS_DRAIN_PER_DAY)} steps, so a day of ${n(STEPS_UNITS_PER_T1)} banks ${n(STEPS_UNITS_PER_T1 - STEPS_DRAIN_PER_DAY)} net.` },
    ],
    [
      lead('Health.'),
      { text: ` One point each for sleep recorded, any food logged and a weight, per day. ${HEALTH_POINTS_PER_T1} points make a ${health.tiers[0].name}; the bank drains ${HEALTH_DRAIN_PER_DAY} a day, so logging two of the three holds it level.` },
    ],
    [
      lead('Cardio.'),
      { text: ` One walk, run, treadmill, hike, cycle, swim or HIIT session makes a ${cardio.tiers[0].name}${CARDIO_UNITS_PER_SESSION === CARDIO_UNITS_PER_T1 ? '' : ' (part of one)'}; the bank drains ${CARDIO_DRAIN_PER_DAY}/${CARDIO_UNITS_PER_SESSION} of a session a day. These numbers are provisional and may be retuned.` },
    ],
    [
      lead('Gaps cost you one at a time.'),
      { text: ' When a bank runs down, the row loses its smallest creature — and a big one breaks back down into smaller ones rather than vanishing, so a long gap costs you progress, never the lot. The days underneath still count.' },
    ],
    [
      lead('Your own rest days are free.'),
      { text: ' How long a gap can be for the Tank row comes from ' },
      { text: 'your schedule', style: 'em' },
      { text: ', not a fixed number — and a rest day you chose, or a deload the app asked you to take, does not count against it at all. Following your own plan never costs you anything.' },
    ],
  ]
}
