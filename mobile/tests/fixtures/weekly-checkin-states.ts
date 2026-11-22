// #3890: the weekly check-in routes' response shapes (PR #4029), filled with made-up data. They are
// parsed by the app's own schema before any test uses them, so a field the schema does not know, or
// a shape that has drifted, fails here first.
import {
  checkinStateSchema,
  saveOutcomeSchema,
  type CheckinState,
} from '../../src/features/home/data/weekly-checkin.ts';

export const ID = {
  checkin: '20000000-0000-4000-8000-000000000001',
  squat: '20000000-0000-4000-8000-0000000000a1',
  bench: '20000000-0000-4000-8000-0000000000a2',
  row: '20000000-0000-4000-8000-0000000000a3',
  long: '20000000-0000-4000-8000-0000000000a4',
  squatLift: '20000000-0000-4000-8000-0000000000b1',
  benchLift: '20000000-0000-4000-8000-0000000000b2',
  rowLift: '20000000-0000-4000-8000-0000000000b3',
  longLift: '20000000-0000-4000-8000-0000000000b4',
  alt1: '20000000-0000-4000-8000-0000000000c1',
  alt2: '20000000-0000-4000-8000-0000000000c2',
  change: '20000000-0000-4000-8000-0000000000d1',
};
export const LONG_NAME = 'Single-Arm Landmine Rotational Press With Pause At The Top';

const lift = (sessionExerciseId: string, exerciseName: string) => ({
  sessionExerciseId,
  exerciseName,
  exerciseId: null,
  missedRep: false,
  lastSession: 'met' as const,
});

export const due: CheckinState = checkinStateSchema.parse({
  due: true,
  why: 'planned_count_reached',
  weekStart: '2026-11-16',
  summary: {
    sessionsDone: 4,
    sessionsPlanned: 4,
    lifts: [],
    shortRestDays: 1,
    lines: [
      '4 of 4 planned sessions done.',
      'Last session: Squat beat the plan, Bench Press met the plan, Barbell Row fell short of the plan.',
      'Short rest cost reps on 1 day.',
    ],
  },
  lifts: [
    lift(ID.squat, 'Squat'),
    lift(ID.bench, 'Bench Press'),
    lift(ID.row, 'Barbell Row'),
    lift(ID.long, LONG_NAME),
  ],
  checkin: {
    id: ID.checkin,
    weekStart: '2026-11-16',
    appliesWeekStart: '2026-11-23',
    status: 'offered',
    savedAt: null,
    dismissedAt: null,
    lifts: [],
    daysOff: null,
    daysOffWritten: null,
    shorterSessionMin: null,
    pain: null,
    swap: null,
    offers: [],
  },
});

const liftRow = (
  liftId: string,
  exerciseName: string,
  answer: string,
  effect: string,
  extra: Record<string, unknown> = {},
) => ({
  liftId,
  exerciseName,
  exerciseId: null,
  answer,
  missedRep: false,
  effect,
  offerStatus: null,
  appliedChangeId: null,
  holdLive: effect === 'held' ? false : null,
  ...extra,
});

/** A saved check-in with one of every kind of row. */
export const savedRaw = {
  ...due,
  due: false,
  why: null,
  checkin: {
    ...due.checkin!,
    status: 'saved',
    savedAt: '2026-11-22T18:00:00.000Z',
    lifts: [
      liftRow(ID.squatLift, 'Squat', 'heavy', 'lowered_one_step', { missedRep: true, appliedChangeId: ID.change }),
      liftRow(ID.benchLift, 'Bench Press', 'heavy', 'held'),
      liftRow(ID.rowLift, 'Barbell Row', 'light', 'offered_step_up', { offerStatus: 'open' }),
      liftRow(ID.longLift, LONG_NAME, 'about_right', 'none'),
    ],
    daysOff: [3, 6],
    daysOffWritten: ['2026-11-26'],
    shorterSessionMin: 45,
    pain: { exerciseName: 'Squat', exerciseId: null, where: 'left knee' },
    swap: { exerciseName: 'Barbell Row', exerciseId: null },
    offers: [
      { kind: 'step_up', liftId: ID.rowLift, exerciseName: 'Barbell Row', status: 'open', changeId: null },
      { kind: 'pain', exerciseName: 'Squat', where: 'left knee', status: 'open', injuryId: null, muscles: ['Quads', 'Glutes'] },
      {
        kind: 'swap',
        exerciseName: 'Barbell Row',
        status: 'open',
        changeId: null,
        alternatives: [
          { exerciseId: ID.alt1, name: 'Chest-Supported Row', equipment: ['dumbbell'], mainMuscles: ['Lats'] },
          { exerciseId: ID.alt2, name: 'Seated Cable Row', equipment: ['cable'], mainMuscles: ['Lats'] },
        ],
      },
    ],
  },
};
export const saved: CheckinState = checkinStateSchema.parse(savedRaw);

export const saveResponse = saveOutcomeSchema.parse({
  state: savedRaw,
  kept: [],
  notApplied: [],
});

/** The save answered for a lift whose lowering the person undid: it stays held (noted). */
export const savedWithNotApplied = saveOutcomeSchema.parse({
  state: {
    ...savedRaw,
    checkin: {
      ...savedRaw.checkin,
      lifts: [liftRow(ID.squatLift, 'Squat', 'heavy', 'held')],
      offers: [],
      daysOff: null,
      daysOffWritten: null,
      shorterSessionMin: null,
      pain: false,
      swap: null,
    },
  },
  kept: [],
  notApplied: [
    { exerciseName: 'Squat', detail: 'You undid this lowering, so saving again does not redo it.', reason: 'undone' },
  ],
});
