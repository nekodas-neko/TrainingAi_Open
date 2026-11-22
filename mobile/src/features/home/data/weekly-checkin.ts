import { z } from 'zod';
import { CHECKIN_ANSWERS, type CheckinAnswer, type CheckinEffect } from '@trainingai/shared/weekly-checkin/effects';
import type { CheckinDueWhy } from '@trainingai/shared/weekly-checkin/due';
import type { CheckinSummary, LastSessionAgainstPlan } from '@trainingai/shared/weekly-checkin/summary';
import { MIN_PRESET_BUDGET_MIN } from '@trainingai/shared/workout/duration-model';

// #3890 step 3: the weekly check-in's Home card and sheet read and write the engine's five routes
// (app/api/weekly-checkin/**, PR #4029). The response interfaces live in lib/weekly-checkin/engine.ts,
// which is server code the app cannot import, so this schema mirrors them field for field, built on
// the shared enums and types. It keeps only what the screens use. Every word the result shows about
// an effect comes from a server field; nothing here works out an effect itself.

const answer = z.enum(CHECKIN_ANSWERS);
const effect = z.enum(['held', 'lowered_one_step', 'offered_step_up', 'none'] satisfies CheckinEffect[]);
const offerStatus = z.enum(['open', 'accepted', 'declined']);
const lastSession = z.enum(['beat', 'met', 'short', 'not_compared'] satisfies LastSessionAgainstPlan[]);

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
  lastSession: lastSession.nullable(),
});

const offerSchema = z.discriminatedUnion('kind', [
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
  status: z.enum(['offered', 'saved', 'dismissed']),
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
      holdLive: z.boolean().nullable(),
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
  offers: z.array(offerSchema),
});

export const checkinStateSchema = z.object({
  due: z.boolean(),
  why: z
    .enum([
      'planned_count_reached',
      'last_planned_day_logged',
      'sunday_evening',
      'grace_monday',
    ] satisfies CheckinDueWhy[])
    .nullable(),
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
      reason: z.enum(['refused', 'undone', 'swapped']),
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

/** The day's state; "today" is in the key so yesterday's card is never painted as today's. */
export const weeklyCheckinSpec = (today: string) => ({
  path: '/api/weekly-checkin',
  partition: today,
  ttl: 300_000,
  schema: checkinStateSchema,
});

export const CHECKIN_PATH = '/api/weekly-checkin';

/** "Later" on this phone, for today only: the card is back tomorrow while its window is open. */
export const laterKey = (weekStart: string, today: string) => `weekly-checkin-later:${weekStart}:${today}`;

export type CardView =
  | { kind: 'due'; title: string }
  | { kind: 'saved'; changes: number; openOffers: number }
  | null;

export function cardView(
  state: CheckinState | null,
  markers: Readonly<Record<string, boolean>>,
  today: string,
): CardView {
  if (!state?.weekStart || !state.checkin) return null;
  if (state.checkin.status === 'saved') {
    return { kind: 'saved', ...changeCount(state.checkin) };
  }
  if (!state.due || state.checkin.status !== 'offered' || !state.summary) return null;
  if (markers[laterKey(state.weekStart, today)]) return null;
  const { sessionsDone, sessionsPlanned } = state.summary;
  return {
    kind: 'due',
    title:
      sessionsPlanned == null
        ? `Your week in review: ${sessionsDone} ${sessionsDone === 1 ? 'session' : 'sessions'}`
        : `Your week in review: ${sessionsDone} of ${sessionsPlanned} sessions`,
  };
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
  offer?: { question: string; accept: OfferAction; acceptLabel: string; decline: OfferAction };
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
        status: 'One step lighter next time',
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
              : 'Offered, not changed yet',
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
    } else {
      rows.push({
        ...base,
        title: `${lift.exerciseName}: ${lift.answer === 'heavy' ? 'Heavy' : lift.answer === 'light' ? 'Light' : 'About right'}`,
        status: 'No change',
      });
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
              : 'Offered, not logged yet',
        undo: offer.status === 'accepted' ? { kind: 'pain' } : undefined,
        offer:
          offer.status === 'open'
            ? {
                question: muscle ? `Log an injury to ${muscle}?` : 'Log an injury?',
                accept: { kind: 'pain' },
                acceptLabel: 'Log injury',
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
