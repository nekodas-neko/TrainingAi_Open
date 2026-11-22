/**
 * #4037: what the weekly check-in's five routes return, defined once. The engine (`lib/weekly-checkin/engine.ts`)
 * builds these shapes and the Preview app (`mobile/`) reads them; both import this file, so a field renamed
 * on one side fails the other's type check, not the phone at run time.
 *
 * Two schemas per shape, from one field list:
 *   - the plain one (`checkinStateSchema`, `saveOutcomeSchema`, ...) says exactly what the server sends:
 *     its inferred types are the engine's return types. Nothing on the server parses its own output with
 *     it; a route returns what the engine built, byte for byte.
 *   - the `lenient` one is what the phone parses with. It differs only where a screen branches on a
 *     value or a value is optional to it: a value of a list this build does not know becomes `'unknown'`
 *     (the screen then shows a safe, truthful row) or `null`, and an offer of an unknown kind is left out,
 *     so a server newer than the app never makes the check-in unreadable.
 *
 * Every list a screen branches on is checked against the shared type it mirrors (`Exhaustive`): a member
 * the type has and the list lacks fails the type check.
 */
import { z } from 'zod'
import { CHECKIN_ANSWERS, type CheckinAnswer, type CheckinEffect } from './effects'
import type { CheckinDueWhy } from './due'
import type {
  CheckinSummary, LastSessionAgainstPlan, LiftDirection, LiftWhy, NotComparedWhy,
} from './summary'
import type { SessionVerdict } from '../ai-periodization/session-read'

type Exhaustive<Union, List extends readonly unknown[]> = [Exclude<Union, List[number]>] extends [never]
  ? true
  : { missing: Exclude<Union, List[number]> }
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false

export const CHECKIN_EFFECTS = ['held', 'lowered_one_step', 'offered_step_up', 'none'] as const satisfies readonly CheckinEffect[]
export const CHECKIN_LAST_SESSIONS = ['beat', 'met', 'short', 'heavier', 'not_compared'] as const satisfies readonly LastSessionAgainstPlan[]
export const CHECKIN_DUE_WHY = ['planned_count_reached', 'last_planned_day_logged', 'sunday_evening', 'grace_monday'] as const satisfies readonly CheckinDueWhy[]
export const CHECKIN_STATUSES = ['offered', 'saved', 'dismissed'] as const
export const CHECKIN_OFFER_STATUSES = ['open', 'accepted', 'declined'] as const
export const CHECKIN_NOT_APPLIED_REASONS = ['refused', 'undone', 'swapped'] as const
const NOT_COMPARED_WHY = ['incomplete', 'deload', 'baseline', 'override', 'no_weight', 'too_few_planned_sets'] as const satisfies readonly NotComparedWhy[]
const LIFT_DIRECTIONS = ['up', 'steady', 'held', 'down', 'unknown'] as const satisfies readonly LiftDirection[]
const LIFT_WHY = ['more_load', 'more_reps', 'short_rest', 'heart_rate', 'felt_hard', 'missed_reps', 'logging_slip'] as const satisfies readonly NonNullable<LiftWhy>[]
const SESSION_VERDICTS = ['too-little-data', 'reduce', 'hold-rest-more', 'hold-recovery', 'progress-load', 'progress-reps', 'hold'] as const satisfies readonly SessionVerdict[]

const checkedLists: [
  Exhaustive<CheckinEffect, typeof CHECKIN_EFFECTS>,
  Exhaustive<LastSessionAgainstPlan, typeof CHECKIN_LAST_SESSIONS>,
  Exhaustive<CheckinDueWhy, typeof CHECKIN_DUE_WHY>,
  Exhaustive<CheckinAnswer, typeof CHECKIN_ANSWERS>,
  Exhaustive<NotComparedWhy, typeof NOT_COMPARED_WHY>,
  Exhaustive<LiftDirection, typeof LIFT_DIRECTIONS>,
  Exhaustive<NonNullable<LiftWhy>, typeof LIFT_WHY>,
  Exhaustive<SessionVerdict, typeof SESSION_VERDICTS>,
] = [true, true, true, true, true, true, true, true]
void checkedLists

// ── The shapes, as the server sends them ────────────────────────────────────────────────────

/** The week's summary: the card reads the first three fields; `lifts` and `shortRestDays` are the shadow read, kept for later. */
export const checkinSummarySchema = z.object({
  sessionsDone: z.number(),
  sessionsPlanned: z.number().nullable(),
  lifts: z.array(z.object({
    exerciseName: z.string(),
    exerciseId: z.string().nullable(),
    sessions: z.number(),
    lastSession: z.enum(CHECKIN_LAST_SESSIONS).nullable(),
    notComparedWhy: z.enum(NOT_COMPARED_WHY).nullable(),
    missedRep: z.boolean().nullable(),
    shadow: z.object({
      verdict: z.enum(SESSION_VERDICTS),
      direction: z.enum(LIFT_DIRECTIONS),
      why: z.enum(LIFT_WHY).nullable(),
    }).nullable(),
  })),
  shortRestDays: z.number(),
  lines: z.tuple([z.string(), z.string(), z.string()]),
})

export const checkinStateLiftSchema = z.object({
  /** Send this back as the lift's id in a save. Any slot of the lift is accepted. */
  sessionExerciseId: z.string(),
  exerciseName: z.string(),
  exerciseId: z.string().nullable(),
  /** Decision 9's missed rep for this lift (its last session of the week), the value a save acts on. */
  missedRep: z.boolean().nullable(),
  /** That session against the plan; null when the lift was not logged this week. */
  lastSession: z.enum(CHECKIN_LAST_SESSIONS).nullable(),
})

export const swapAlternativeSchema = z.object({
  exerciseId: z.string(),
  name: z.string(),
  equipment: z.array(z.string()),
  mainMuscles: z.array(z.string()),
})

const offerStatus = z.enum(CHECKIN_OFFER_STATUSES)
export const checkinOfferSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('step_up'), liftId: z.string(), exerciseName: z.string(), status: offerStatus, changeId: z.string().nullable() }),
  z.object({ kind: z.literal('pain'), exerciseName: z.string(), where: z.string().nullable(), status: offerStatus, injuryId: z.string().nullable(), muscles: z.array(z.string()) }),
  z.object({ kind: z.literal('swap'), exerciseName: z.string(), status: offerStatus, changeId: z.string().nullable(), alternatives: z.array(swapAlternativeSchema) }),
])

export const checkinViewLiftSchema = z.object({
  liftId: z.string(),
  exerciseName: z.string(),
  exerciseId: z.string().nullable(),
  answer: z.enum(CHECKIN_ANSWERS),
  missedRep: z.boolean().nullable(),
  effect: z.enum(CHECKIN_EFFECTS),
  offerStatus: z.string().nullable(),
  appliedChangeId: z.string().nullable(),
  /**
   * For `held`: whether the plan's hold caps this lift (`liftsTheHoldCaps`): it has a last bar and
   * carries a load. False for a lift never logged, last logged in a deload, or bodyweight: the card
   * then says "noted", never "held". Null for every other effect.
   */
  holdLive: z.boolean().nullable(),
  /**
   * For `held` and `lowered_one_step`: whether the plan caps the lift at its last bar this week (the
   * same test as `holdLive`). A lowered lift gets the lower of one step under the plan and its last bar.
   * Null for every other effect.
   */
  capped: z.boolean().nullable(),
})

export const checkinViewSchema = z.object({
  id: z.string(),
  weekStart: z.string(),
  appliesWeekStart: z.string(),
  status: z.enum(CHECKIN_STATUSES),
  savedAt: z.string().nullable(),
  dismissedAt: z.string().nullable(),
  lifts: z.array(checkinViewLiftSchema),
  daysOff: z.array(z.number()).nullable(),
  /** The dates the check-in itself made rest days (A1): a date already resting when it applied is not here. */
  daysOffWritten: z.array(z.string()).nullable(),
  shorterSessionMin: z.number().nullable(),
  pain: z.union([z.literal(false), z.null(), z.object({ exerciseName: z.string(), exerciseId: z.string().nullable(), where: z.string().nullable() })]),
  swap: z.object({ exerciseName: z.string(), exerciseId: z.string().nullable() }).nullable(),
  offers: z.array(checkinOfferSchema),
})

export const checkinStateSchema = z.object({
  /** Whether the card should show now. */
  due: z.boolean(),
  why: z.enum(CHECKIN_DUE_WHY).nullable(),
  /** The week under review (local Monday), whether due or already answered; null when none. */
  weekStart: z.string().nullable(),
  summary: checkinSummarySchema.nullable(),
  /** The main lifts to ask about. Empty when nothing is under review. */
  lifts: z.array(checkinStateLiftSchema),
  checkin: checkinViewSchema.nullable(),
})

export const saveOutcomeSchema = z.object({
  state: checkinStateSchema,
  /** Lifts whose earlier change could not be taken back and so stays as it was (never doubled). */
  kept: z.array(z.object({ exerciseName: z.string(), detail: z.string() })),
  /**
   * Lifts whose lowering was not applied, so they are `held` instead:
   *   - `refused`: the writer refused it (the detail says why);
   *   - `undone`: the person undid this check-in's lowering, and saving the same answer again does not
   *     redo it. Changing the answer away and back is the way to ask for it again;
   *   - `swapped`: the slot now holds the lift an accepted swap put there, so a lowering would land on it.
   */
  notApplied: z.array(z.object({ exerciseName: z.string(), detail: z.string(), reason: z.enum(CHECKIN_NOT_APPLIED_REASONS) })),
})

export type CheckinSummaryShape = z.infer<typeof checkinSummarySchema>
export type CheckinStateLift = z.infer<typeof checkinStateLiftSchema>
export type SwapAlternative = z.infer<typeof swapAlternativeSchema>
export type CheckinOffer = z.infer<typeof checkinOfferSchema>
export type CheckinView = z.infer<typeof checkinViewSchema>
export type CheckinState = z.infer<typeof checkinStateSchema>
export type SaveOutcome = z.infer<typeof saveOutcomeSchema>

// The summary is the shared `CheckinSummary` itself: the engine returns that type, so the two cannot differ.
const summaryMatches: Same<CheckinSummaryShape, CheckinSummary> = true
void summaryMatches

// ── The phone's reading of them ─────────────────────────────────────────────────────────────

/** A value a screen branches on: a known one as is, any other becomes `'unknown'` (never a parse failure). */
const orUnknown = <const T extends readonly [string, ...string[]]>(list: T) =>
  z.union([z.enum(list), z.string().transform((): 'unknown' => 'unknown')])
/** A value a screen never branches on: a known one as is, any other is dropped to null. */
const knownOrNull = <const T extends readonly [string, ...string[]]>(list: T) => z.enum(list).nullable().catch(null)
/** A flag the screens trust only when it is a plain boolean: anything else reads as not known. */
const flagOrNull = z.boolean().nullable().catch(null)

/** The summary fields the card and sheet read; the shadow read is never parsed on the phone. */
export const lenientCheckinSummarySchema = checkinSummarySchema.pick({ sessionsDone: true, sessionsPlanned: true, lines: true })

export const lenientCheckinStateLiftSchema = checkinStateLiftSchema.extend({
  lastSession: knownOrNull(CHECKIN_LAST_SESSIONS),
})

const [stepUpOffer, painOffer, swapOffer] = checkinOfferSchema.options
const lenientStatus = orUnknown(CHECKIN_OFFER_STATUSES)
const lenientOfferSchema = z.discriminatedUnion('kind', [
  stepUpOffer.extend({ status: lenientStatus }),
  painOffer.extend({ status: lenientStatus }),
  swapOffer.extend({ status: lenientStatus }),
])

export const lenientCheckinViewLiftSchema = checkinViewLiftSchema.extend({
  answer: orUnknown(CHECKIN_ANSWERS),
  effect: orUnknown(CHECKIN_EFFECTS),
  holdLive: flagOrNull,
  // A state cached before the field existed has none: read as not known, which words nothing as capped.
  capped: flagOrNull,
})

export const lenientCheckinViewSchema = checkinViewSchema.extend({
  status: orUnknown(CHECKIN_STATUSES),
  // Not read by a screen.
  dismissedAt: z.string().nullable().catch(null),
  lifts: z.array(lenientCheckinViewLiftSchema),
  // An offer of a kind this build does not know is left out; the rest of the check-in still shows.
  offers: z.array(z.unknown()).transform(items => items.flatMap(item => {
    const parsed = lenientOfferSchema.safeParse(item)
    return parsed.success ? [parsed.data] : []
  })),
})

export const lenientCheckinStateSchema = checkinStateSchema.extend({
  why: knownOrNull(CHECKIN_DUE_WHY),
  summary: lenientCheckinSummarySchema.nullable(),
  lifts: z.array(lenientCheckinStateLiftSchema),
  checkin: lenientCheckinViewSchema.nullable(),
})

export const lenientSaveOutcomeSchema = saveOutcomeSchema.extend({
  state: lenientCheckinStateSchema,
  notApplied: z.array(z.object({ exerciseName: z.string(), detail: z.string(), reason: z.string() })),
})

export type LenientCheckinState = z.infer<typeof lenientCheckinStateSchema>
export type LenientCheckinView = NonNullable<LenientCheckinState['checkin']>
export type LenientSaveOutcome = z.infer<typeof lenientSaveOutcomeSchema>
