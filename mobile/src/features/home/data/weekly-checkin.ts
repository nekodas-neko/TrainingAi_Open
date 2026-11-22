import { z } from 'zod';
import { CHECKIN_ANSWERS, type CheckinAnswer, type CheckinEffect } from '@trainingai/shared/weekly-checkin/effects';
import type { CheckinDueWhy } from '@trainingai/shared/weekly-checkin/due';
import type { CheckinSummary, LastSessionAgainstPlan } from '@trainingai/shared/weekly-checkin/summary';
import { shiftDateStr, weekStartForDay } from '@trainingai/shared/date-utils';
import { MIN_PRESET_BUDGET_MIN } from '@trainingai/shared/workout/duration-model';

// #3890 step 3: the weekly check-in's Home card and sheet read and write the engine's five routes
// (app/api/weekly-checkin/**, PR #4029). The response interfaces live in lib/weekly-checkin/engine.ts,
// which is server code the app cannot import, so this schema mirrors them field for field, built on
// the shared enums and types. It keeps only what the screens use. Every word the result shows about
// an effect comes from a server field; nothing here works out an effect itself.

// Every list below is checked against the shared type it mirrors: a member the shared type has and
// the list lacks fails the type check (`Exhaustive`), so a value the engine adds cannot be missed
// here silently. `satisfies` alone would only catch an extra member.
type Exhaustive<Union, List extends readonly unknown[]> = [Exclude<Union, List[number]>] extends [never]
  ? true
  : { missing: Exclude<Union, List[number]> };
const EFFECTS = ['held', 'lowered_one_step', 'offered_step_up', 'none'] as const satisfies readonly CheckinEffect[];
const LAST_SESSIONS = [
  'beat',
  'met',
  'short',
  'heavier',
  'not_compared',
] as const satisfies readonly LastSessionAgainstPlan[];
const DUE_WHY = [
  'planned_count_reached',
  'last_planned_day_logged',
  'sunday_evening',
  'grace_monday',
] as const satisfies readonly CheckinDueWhy[];
const checkedLists: [
  Exhaustive<CheckinEffect, typeof EFFECTS>,
  Exhaustive<LastSessionAgainstPlan, typeof LAST_SESSIONS>,
  Exhaustive<CheckinDueWhy, typeof DUE_WHY>,
  Exhaustive<CheckinAnswer, typeof CHECKIN_ANSWERS>,
] = [true, true, true, true];
void checkedLists;

/** A value the screens branch on: a known one as is, any other becomes `'unknown'` (never a parse failure). */
const orUnknown = <const T extends readonly [string, ...string[]]>(list: T) =>
  z.union([z.enum(list), z.string().transform((): 'unknown' => 'unknown')]);
/** A value the screens never branch on: a known one as is, any other is dropped to null. */
const knownOrNull = <const T extends readonly [string, ...string[]]>(list: T) =>
  z.enum(list).nullable().catch(null);

const answer = orUnknown(CHECKIN_ANSWERS);
const effect = orUnknown(EFFECTS);
const offerStatus = orUnknown(['open', 'accepted', 'declined'] as const);
const lastSession = knownOrNull(LAST_SESSIONS);

const summarySchema = z.object({
  sessionsDone: z.number(),
  sessionsPlanned: z.number().nullable(),
  lines: z.tuple([z.string(), z.string(), z.string()]),
});

const stateLiftSchema = z.object({
  sessionExerciseId: z.string(),
  exerciseName: z.string(),
  exerciseId: z.string().nullable(),
  missedRep: z.boolean().nullable(),
  lastSession,
});

const knownOffer = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('step_up'),
    liftId: z.string(),
    exerciseName: z.string(),
    status: offerStatus,
    changeId: z.string().nullable(),
  }),
  z.object({
    kind: z.literal('pain'),
    exerciseName: z.string(),
    where: z.string().nullable(),
    status: offerStatus,
    injuryId: z.string().nullable(),
    muscles: z.array(z.string()),
  }),
  z.object({
    kind: z.literal('swap'),
    exerciseName: z.string(),
    status: offerStatus,
    changeId: z.string().nullable(),
    alternatives: z.array(
      z.object({
        exerciseId: z.string(),
        name: z.string(),
        equipment: z.array(z.string()),
        mainMuscles: z.array(z.string()),
      }),
    ),
  }),
]);

const viewSchema = z.object({
  id: z.string(),
  weekStart: z.string(),
  appliesWeekStart: z.string(),
  status: orUnknown(['offered', 'saved', 'dismissed'] as const),
  savedAt: z.string().nullable(),
  lifts: z.array(
    z.object({
      liftId: z.string(),
      exerciseName: z.string(),
      exerciseId: z.string().nullable(),
      answer,
      missedRep: z.boolean().nullable(),
      effect,
      offerStatus: z.string().nullable(),
      appliedChangeId: z.string().nullable(),
      // Anything but a plain true is read as not live: the row never claims a hold it cannot vouch for.
      holdLive: z.boolean().nullable().catch(null),
    }),
  ),
  daysOff: z.array(z.number()).nullable(),
  daysOffWritten: z.array(z.string()).nullable(),
  shorterSessionMin: z.number().nullable(),
  pain: z.union([
    z.literal(false),
    z.null(),
    z.object({ exerciseName: z.string(), exerciseId: z.string().nullable(), where: z.string().nullable() }),
  ]),
  swap: z.object({ exerciseName: z.string(), exerciseId: z.string().nullable() }).nullable(),
  // An offer of a kind this build does not know is left out; the rest of the check-in still shows.
  offers: z
    .array(z.unknown())
    .transform((items) => items.flatMap((item) => {
      const parsed = knownOffer.safeParse(item);
      return parsed.success ? [parsed.data] : [];
    })),
});

export const checkinStateSchema = z.object({
  due: z.boolean(),
  why: knownOrNull(DUE_WHY),
  weekStart: z.string().nullable(),
  summary: summarySchema.nullable(),
  lifts: z.array(stateLiftSchema),
  checkin: viewSchema.nullable(),
});

export const saveOutcomeSchema = z.object({
  state: checkinStateSchema,
  kept: z.array(z.object({ exerciseName: z.string(), detail: z.string() })),
  notApplied: z.array(
    z.object({
      exerciseName: z.string(),
      detail: z.string(),
      reason: z.string(),
    }),
  ),
});

export type CheckinState = z.infer<typeof checkinStateSchema>;
export type CheckinView = NonNullable<CheckinState['checkin']>;
export type CheckinOffer = CheckinView['offers'][number];
export type SaveOutcome = z.infer<typeof saveOutcomeSchema>;
export type SaveNotes = Pick<SaveOutcome, 'kept' | 'notApplied'>;

// The summary fields the card reads are the shared type's own.
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const summaryMatches: Same<
  z.infer<typeof summarySchema>,
  Pick<CheckinSummary, 'sessionsDone' | 'sessionsPlanned' | 'lines'>
> = true;
void summaryMatches;

/**
 * The state, cached under one key so a repeat visit paints the last known card at once and revalidates
 * behind it. A cached state is only shown while it is for a week the card can still be about
 * (`isReviewWeek`), so an old week's card is never painted as today's.
 */
export const weeklyCheckinSpec = () => ({
  path: '/api/weekly-checkin',
  ttl: 300_000,
  schema: checkinStateSchema,
});

/** This week or last week (the Monday grace window): the only weeks a check-in can be about. */
export function isReviewWeek(weekStart: string | null, today: string) {
  if (!weekStart) return false;
  const thisWeek = weekStartForDay(today);
  return weekStart === thisWeek || weekStart === shiftDateStr(thisWeek, -7);
}

export const CHECKIN_PATH = '/api/weekly-checkin';

/** "Later" on this phone, for today only: the card is back tomorrow while its window is open. */
export const LATER_PREFIX = 'weekly-checkin-later:';
export const laterKey = (weekStart: string, today: string) => `${LATER_PREFIX}${weekStart}:${today}`;

export type CardView =
  | { kind: 'due'; title: string; summary: string }
  | { kind: 'saved'; changes: number; openOffers: number }
  | null;

export function cardView(
  state: CheckinState | null,
  markers: Readonly<Record<string, boolean>>,
  today: string,
): CardView {
  if (!state?.weekStart || !state.checkin || !isReviewWeek(state.weekStart, today)) return null;
  if (state.checkin.status === 'saved') {
    return { kind: 'saved', ...changeCount(state.checkin) };
  }
  if (!state.due || state.checkin.status !== 'offered' || !state.summary) return null;
  if (markers[laterKey(state.weekStart, today)]) return null;
  // The count is the server's own first line; the phone composes none (it can read "5 of 4").
  return { kind: 'due', title: 'Your week in review', summary: state.summary.lines[0] };
}

/**
 * What the saved check-in changed, counted from what the server reports applied: a lowering, an
 * accepted step up, injury or swap, rest days it wrote, and a shorter session. A hold the plan does
 * not enforce yet (`holdLive: false`) is not a change.
 */
export function changeCount(view: CheckinView) {
  let changes = 0;
  for (const lift of view.lifts) {
    if (lift.effect === 'lowered_one_step' && lift.appliedChangeId) changes++;
    if (lift.effect === 'held' && lift.holdLive === true) changes++;
  }
  for (const offer of view.offers) if (offer.status === 'accepted') changes++;
  if (view.daysOffWritten?.length) changes++;
  if (view.shorterSessionMin != null) changes++;
  const openOffers = view.offers.filter((o) => o.status === 'open').length;
  return { changes, openOffers };
}

export function changesLine(changes: number, openOffers: number) {
  const main =
    changes === 0
      ? 'No changes for next week'
      : `${changes} ${changes === 1 ? 'change' : 'changes'} for next week`;
  return openOffers > 0 ? `${main} · ${openOffers} to answer` : main;
}

// ── The answers ─────────────────────────────────────────────────────────────────────────────

export const SESSION_LENGTHS = [
  { label: 'Usual', value: 'usual', minutes: null },
  { label: '45 min', value: '45', minutes: 45 },
  { label: '30 min', value: '30', minutes: 30 },
] as const;
export type SessionLength = (typeof SESSION_LENGTHS)[number]['value'];
// Every offered length is one the save route accepts (its bounds: the preset floor to 240).
SESSION_LENGTHS.forEach((length) => {
  if (length.minutes != null && (length.minutes < MIN_PRESET_BUDGET_MIN || length.minutes > 240))
    throw new Error(`Session length ${length.minutes} is outside what the save accepts.`);
});

export type CheckinAnswers = {
  /** By the slot id the server sent for each lift. */
  lifts: Record<string, CheckinAnswer>;
  pain: 'no' | 'yes';
  painLift: string | null;
  painWhere: string;
  swap: 'no' | 'yes';
  swapLift: string | null;
  /** ISO weekdays, 1 = Monday. */
  daysOff: number[];
  length: SessionLength;
};

/** About right for every lift, nothing hurt, nothing to swap, no days off, the usual length. */
export function defaultAnswers(state: CheckinState): CheckinAnswers {
  return {
    lifts: Object.fromEntries(state.lifts.map((l) => [l.sessionExerciseId, 'about_right' as const])),
    pain: 'no',
    painLift: null,
    painWhere: '',
    swap: 'no',
    swapLift: null,
    daysOff: [],
    length: 'usual',
  };
}

export const PAIN_WHERE_MAX = 200;

/** What still stops a save, in words, or null. */
export function answersIncomplete(answers: CheckinAnswers): string | null {
  if (answers.pain === 'yes' && !answers.painLift) return 'Pick the lift that hurt.';
  if (answers.swap === 'yes' && !answers.swapLift) return 'Pick the lift to swap.';
  return null;
}

/** The save route's body: ids only, as the server sent them. */
export function saveBody(weekStart: string, state: CheckinState, answers: CheckinAnswers) {
  const where = answers.painWhere.trim().slice(0, PAIN_WHERE_MAX);
  return {
    weekStart,
    lifts: state.lifts.map((l) => ({
      sessionExerciseId: l.sessionExerciseId,
      answer: answers.lifts[l.sessionExerciseId] ?? 'about_right',
    })),
    pain:
      answers.pain === 'yes' && answers.painLift
        ? { sessionExerciseId: answers.painLift, where: where || null }
        : false,
    swap: answers.swap === 'yes' && answers.swapLift ? { sessionExerciseId: answers.swapLift } : null,
    daysOff: answers.daysOff.length ? [...new Set(answers.daysOff)].sort((a, b) => a - b) : null,
    shorterSessionMin: SESSION_LENGTHS.find((l) => l.value === answers.length)?.minutes ?? null,
  };
}

// ── After saving ────────────────────────────────────────────────────────────────────────────

export type UndoTarget =
  | { kind: 'lift'; liftId: string }
  | { kind: 'pain' }
  | { kind: 'swap' }
  | { kind: 'days_off' }
  | { kind: 'shorter_session' };
export type OfferAction =
  | { kind: 'step_up'; liftId: string }
  | { kind: 'pain' }
  | { kind: 'swap'; toExerciseId?: string };

export type ResultRow = {
  key: string;
  title: string;
  status: string;
  /** The server's own reason text, when a save could not apply or take back a lift's change. */
  note?: string;
  undo?: UndoTarget;
  /** An open offer: Yes / Not now. */
  offer?: { question: string; accept?: OfferAction; acceptLabel?: string; decline: OfferAction };
  /** An open swap offer: one button per alternative the server listed. */
  alternatives?: { exerciseId: string; label: string }[];
  declineSwap?: OfferAction;
};

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** One row per answer, saying what the server reports it did or is offering. */
export function resultRows(view: CheckinView, notes: SaveNotes | null): ResultRow[] {
  const rows: ResultRow[] = [];
  const noteFor = (name: string) => {
    const reasons = [
      ...(notes?.notApplied.filter((n) => n.exerciseName === name) ?? []),
      ...(notes?.kept.filter((n) => n.exerciseName === name) ?? []),
    ].map((n) => n.detail);
    return reasons.length ? reasons.join(' ') : undefined;
  };
  for (const lift of view.lifts) {
    const base = { key: `lift:${lift.liftId}`, note: noteFor(lift.exerciseName) };
    if (lift.effect === 'lowered_one_step') {
      rows.push({
        ...base,
        title: `${lift.exerciseName}: Heavy`,
        // No change id: the lift already carried that step, so there is nothing of this save's to undo.
        status: lift.appliedChangeId ? 'One step lighter next time' : 'Already set one step lighter',
        undo: lift.appliedChangeId ? { kind: 'lift', liftId: lift.liftId } : undefined,
      });
    } else if (lift.effect === 'held') {
      rows.push({
        ...base,
        title: `${lift.exerciseName}: Heavy`,
        status:
          lift.holdLive === true
            ? `Holding ${lift.exerciseName} next week`
            : 'Noted. Your plan does not change for it yet',
        undo: lift.holdLive === true ? { kind: 'lift', liftId: lift.liftId } : undefined,
      });
    } else if (lift.effect === 'offered_step_up') {
      const offer = view.offers.find((o) => o.kind === 'step_up' && o.liftId === lift.liftId);
      const status = offer?.status ?? lift.offerStatus;
      rows.push({
        ...base,
        title: `${lift.exerciseName}: Light`,
        status:
          status === 'accepted'
            ? 'Step up applied'
            : status === 'declined'
              ? 'Not changed: you said not now'
              : status === 'open'
                ? 'Offered, not changed yet'
                : 'Saved',
        undo: status === 'accepted' ? { kind: 'lift', liftId: lift.liftId } : undefined,
        offer:
          status === 'open'
            ? {
                question: `Step up ${lift.exerciseName}?`,
                accept: { kind: 'step_up', liftId: lift.liftId },
                acceptLabel: 'Yes',
                decline: { kind: 'step_up', liftId: lift.liftId },
              }
            : undefined,
      });
    } else if (lift.effect === 'none') {
      rows.push({
        ...base,
        title: lift.answer === 'unknown' ? lift.exerciseName : `${lift.exerciseName}: ${lift.answer === 'heavy' ? 'Heavy' : lift.answer === 'light' ? 'Light' : 'About right'}`,
        status: 'No change',
      });
    } else {
      // An effect this build does not know: say it was saved, with the server's own text if it sent any.
      rows.push({ ...base, title: lift.exerciseName, status: 'Saved' });
    }
  }
  for (const offer of view.offers) {
    if (offer.kind === 'pain') {
      const muscle = offer.muscles[0];
      rows.push({
        key: 'pain',
        title: `Hurt: ${offer.exerciseName}${offer.where ? ` (${offer.where})` : ''}`,
        status:
          offer.status === 'accepted'
            ? 'Injury logged'
            : offer.status === 'declined'
              ? 'No injury logged'
              : offer.status === 'open'
                ? 'Offered, not logged yet'
                : 'Saved',
        undo: offer.status === 'accepted' ? { kind: 'pain' } : undefined,
        offer:
          offer.status === 'open'
            ? muscle
              ? {
                  question: `Log an injury to ${muscle}?`,
                  accept: { kind: 'pain' },
                  acceptLabel: 'Log injury',
                  decline: { kind: 'pain' },
                }
              : {
                  // The route needs a muscle to log against; with none it would refuse, so only "Not now".
                  question:
                    'The app could not tell which muscle this lift trains. You can log the injury from the injuries screen instead.',
                  decline: { kind: 'pain' },
                }
            : undefined,
      });
    } else if (offer.kind === 'swap') {
      rows.push({
        key: 'swap',
        title: `Swap: ${offer.exerciseName}`,
        status:
          offer.status === 'accepted'
            ? 'Swap applied'
            : offer.status === 'declined'
              ? `Kept ${offer.exerciseName}`
              : offer.status !== 'open'
                ? 'Saved'
                : offer.alternatives.length
                  ? 'Pick one to swap it for, or keep it'
                  : 'No alternative found for the same muscles',
        undo: offer.status === 'accepted' ? { kind: 'swap' } : undefined,
        alternatives:
          offer.status === 'open'
            ? offer.alternatives.map((a) => ({
                exerciseId: a.exerciseId,
                label: a.equipment.length ? `${a.name} · ${a.equipment.join(', ')}` : a.name,
              }))
            : undefined,
        declineSwap: offer.status === 'open' ? { kind: 'swap' } : undefined,
      });
    }
  }
  if (view.daysOff?.length) {
    rows.push({
      key: 'days_off',
      title: `Days off: ${view.daysOff.map((d) => WEEKDAYS[d - 1] ?? String(d)).join(', ')}`,
      status: view.daysOffWritten?.length ? 'Applied as you typed it' : 'No rest day was added',
      undo: { kind: 'days_off' },
    });
  }
  if (view.shorterSessionMin != null) {
    rows.push({
      key: 'shorter_session',
      title: `Session length: ${view.shorterSessionMin} min`,
      status: 'Applied as you typed it',
      undo: { kind: 'shorter_session' },
    });
  }
  return rows;
}

// ── Keeping the sheet true to the state ────────────────────────────────────────────────────

/**
 * After a reload the lifts under review may differ. Answers, and the pain or swap pick, for a lift
 * the server no longer lists are dropped; `reset` says whether anything was.
 */
export function reconcileAnswers(answers: CheckinAnswers, state: CheckinState) {
  const ids = new Set(state.lifts.map((l) => l.sessionExerciseId));
  const kept = Object.entries(answers.lifts).filter(([id]) => ids.has(id));
  const painGone = answers.painLift != null && !ids.has(answers.painLift);
  const swapGone = answers.swapLift != null && !ids.has(answers.swapLift);
  const reset = kept.length !== Object.keys(answers.lifts).length || painGone || swapGone;
  if (!reset) return { answers, reset };
  return {
    reset,
    answers: {
      ...answers,
      lifts: Object.fromEntries(kept),
      painLift: painGone ? null : answers.painLift,
      swapLift: swapGone ? null : answers.swapLift,
    },
  };
}
export const LIFTS_CHANGED_MESSAGE =
  'The lifts for this week changed, so your answers for those were reset. Check them before saving.';

/** The server's reasons for one lift, dropped once that lift's row changes or is undone. */
export function withoutNotesFor(notes: SaveNotes | null, exerciseName: string): SaveNotes | null {
  if (!notes) return notes;
  return {
    kept: notes.kept.filter((n) => n.exerciseName !== exerciseName),
    notApplied: notes.notApplied.filter((n) => n.exerciseName !== exerciseName),
  };
}
/** The lift a row's undo or offer touches, if it is a lift's. */
export function liftOf(view: CheckinView | null, target: UndoTarget | OfferAction) {
  if (target.kind !== 'lift' && target.kind !== 'step_up') return null;
  return view?.lifts.find((l) => l.liftId === target.liftId)?.exerciseName ?? null;
}
