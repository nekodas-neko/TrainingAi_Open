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

/** A bottom tier's row name: "Ranger I" -> "Ranger". A row is named by its bottom tier. */
export function collectionRowName(faucet: keyof typeof V2_LADDERS): string {
  return V2_LADDERS[faucet].tiers[0].name.replace(/ I$/, '')
}

/** "A, B and C". */
const joinList = (items: string[]) =>
  items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`

/**
 * The four short captions under Preview's "How this works" diagrams (#2087): a bold lead and the
 * sentence after it, in the same order as the diagrams (one a day, N make one, a gap costs the
 * smallest, rest days are free). Every name and number is read from the ladders, so the mobile page
 * draws the diagrams and prints these without typing a second copy of the wording.
 */
export function collectionRuleCaptions(): { lead: string; text: string }[] {
  const { workout, steps } = V2_LADDERS
  const rowName = collectionRowName
  const banks = joinList((['steps', 'health', 'cardio'] as const).map(rowName))
  const cost = steps.tiers[1].mergeCost
  return [
    {
      lead: 'One a day.',
      text: ` Each workout gives the ${rowName('workout')} row a ${workout.tiers[0].name}. Steps, health logging and cardio fill a bank that turns into ${banks} cats.`,
    },
    {
      lead: `${cost} make one.`,
      text: ` On the ${banks} rows, ${cost} of a tier make 1 of the next. The ${rowName('workout')} row costs ${workout.tiers.slice(1).map(t => t.mergeCost).join(' · ')}.`,
    },
    {
      lead: 'A gap costs the smallest one.',
      text: ' When a bank runs down the row loses its smallest cat, and a big one breaks back into its parts rather than vanishing.',
    },
    {
      lead: 'Your own rest days are free.',
      text: ` The ${rowName('workout')} row's allowance comes from your schedule, and a rest or deload day the app asked for never counts against it.`,
    },
  ]
}
