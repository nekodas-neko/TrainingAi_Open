// #3900 screen half (mockup 1A): the AI program's pre-workout screen as a view model. Each state of
// the issue maps to its header, Start label, link and controls; the rest is the rows and notes.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  planStartModel,
  type PlanPrescription,
  type PlanStartInput,
} from '../src/features/workouts/data/plan-start.ts';
import type { ExercisePreview } from '../src/features/workouts/catalog.ts';

function lift(id: string, over: Partial<ExercisePreview> = {}): ExercisePreview {
  return {
    id,
    name: `Lift ${id}`,
    muscles: ['chest'],
    sets: [1, 2, 3].map((number) => ({
      number,
      reps: 8,
      percent: 82.5,
      restSeconds: 120,
    })),
    setCount: 3,
    style: null,
    instructions: null,
    exerciseType: 'weighted',
    deloaded: false,
    lastWeights: [80, 80, 80],
    equipment: [],
    estimated1rm: 100,
    target80: null,
    latestWeight: null,
    lastSetMode: null,
    ...over,
  };
}

const plan = (over: Partial<PlanPrescription> = {}): PlanPrescription => ({
  phase: 'accumulation',
  phaseAction: 'stay',
  reasoning: 'Your lifts moved well last week.',
  deload: false,
  estimatedSessionDurationMin: 62,
  exercises: [],
  ...over,
});

function input(over: Partial<PlanStartInput> = {}): PlanStartInput {
  const exercises = [lift('a'), lift('b'), lift('c'), lift('d')];
  return {
    aiDynamic: true,
    sessionId: 's1',
    sessionName: 'Upper',
    isBaseline: false,
    exercises,
    asSent: exercises,
    durationMinutes: 60,
    phaseDetail: 'Accumulation · Session 2',
    preparing: false,
    prescription: plan(),
    prescriptionStatus: 'auto_applied',
    deloadChosen: false,
    active: null,
    units: {},
    ...over,
  };
}

test('an ordinary day: plan header, one Start, a quiet Deload link, nothing to confirm', () => {
  const model = planStartModel(input())!;
  assert.equal(model.header, "Today's plan · Accumulation · Session 2");
  assert.equal(model.meta, '4 exercises · about 62 min');
  assert.equal(model.start.label, 'Start workout');
  assert.deepEqual(model.link, { kind: 'deload', label: 'Deload today instead', busy: false });
  assert.equal(model.suggestion, null);
  assert.equal(model.typeLabel, null);
  assert.equal(model.reason, 'Your lifts moved well last week.');
});

test('a day the plan prescribes a deload: Start deload, Train full instead, its reasoning', () => {
  const deload = plan({
    phase: 'deload',
    phaseAction: 'deload_recommended',
    deload: true,
    reasoning: 'Three hard weeks in a row.',
    estimatedSessionDurationMin: 40,
  });
  const model = planStartModel(
    input({ prescription: deload, deloadChosen: true, prescriptionStatus: 'auto_applied' }),
  )!;
  assert.equal(model.header, "Today's plan · Deload · prescribed");
  assert.equal(model.start.label, 'Start deload');
  assert.deepEqual(model.link, { kind: 'full', label: 'Train full instead', busy: false });
  assert.equal(model.reason, 'Three hard weeks in a row.');
  assert.equal(model.meta, '4 exercises · about 40 min');
});

test('a deload the lifter chose on an ordinary day says so, and Train full instead undoes it', () => {
  const model = planStartModel(input({ deloadChosen: true }))!;
  assert.equal(model.header, "Today's plan · Deload · your choice");
  assert.equal(model.start.label, 'Start deload');
  assert.equal(model.link?.label, 'Train full instead');
});

test('Train full over a prescribed deload reads as the lifter\'s override, with the way back', () => {
  const model = planStartModel(
    input({ prescription: plan({ deload: true, phaseAction: 'deload_recommended' }), deloadChosen: false }),
  )!;
  assert.equal(model.header, "Today's plan · Full · your choice");
  assert.equal(model.start.label, 'Start workout');
  assert.equal(model.link?.label, 'Deload today instead');
});

test('a rest-day suggestion is a note with its own button, and Start is untouched', () => {
  const model = planStartModel(
    input({
      prescription: plan({
        phaseAction: 'rest_day_recommended',
        reasoning: 'Readiness is low. A rest day would help.',
      }),
    }),
  )!;
  assert.equal(model.suggestion?.message, 'Readiness is low. A rest day would help.');
  assert.deepEqual(model.suggestion?.action, { kind: 'rest', label: 'Rest today' });
  assert.equal(model.start.label, 'Start workout');
  assert.equal(model.link?.kind, 'deload');
  // The reasoning is in the note; the card does not say it twice.
  assert.equal(model.reason, null);
});

test('a swap suggestion is a note without a button: Preview has no swap action today', () => {
  const model = planStartModel(
    input({
      prescription: plan({ phaseAction: 'session_swap_recommended', reasoning: 'Chest is sore.' }),
    }),
  )!;
  assert.equal(model.suggestion?.message, 'Chest is sore.');
  assert.equal(model.suggestion?.action, null);
  assert.equal(model.start.label, 'Start workout');
});

test('a plan being prepared keeps Start as it is and says so', () => {
  const model = planStartModel(input({ preparing: true, prescription: null, prescriptionStatus: undefined }))!;
  assert.equal(model.preparing, true);
  assert.equal(model.start.label, 'Start workout');
  assert.equal(model.header, "Today's plan · Accumulation · Session 2");
});

test('no plan and none coming: Start still works with what the app has', () => {
  const model = planStartModel(
    input({ prescription: null, prescriptionStatus: undefined, phaseDetail: null }),
  )!;
  assert.equal(model.header, "Today's plan");
  assert.equal(model.start.label, 'Start workout');
  assert.equal(model.meta, '4 exercises · about 60 min');
  assert.equal(model.reason, null);
  assert.equal(model.suggestion, null);
  assert.equal(model.rows.length, 4);
});

test('a plan held for a workout under way: Resume, no deload link, the stored type as a label', () => {
  const active = { sessionId: 's1', sessionName: 'Upper', intensityMode: 'deload' as const };
  const model = planStartModel(input({ active }))!;
  assert.equal(model.start.label, 'Resume workout');
  assert.equal(model.link, null);
  assert.equal(model.typeLabel, 'Deload session');
  assert.equal(planStartModel(input({ active: { ...active, intensityMode: 'full' } }))!.typeLabel, 'Full session');
});

test('another session under way: Start names it, and no label or link is drawn for this one', () => {
  const model = planStartModel(
    input({ active: { sessionId: 's2', sessionName: 'Lower', intensityMode: 'full' } }),
  )!;
  assert.equal(model.start.label, 'Resume Lower');
  assert.equal(model.link, null);
  assert.equal(model.typeLabel, null);
});

test('a move still waiting for the switch-over keeps Accept, and only that does', () => {
  const waiting = planStartModel(
    input({
      prescription: plan({ phase: 'intensification', phaseAction: 'transition_recommended' }),
      prescriptionStatus: 'pending',
    }),
  )!;
  assert.deepEqual(waiting.suggestion?.action, {
    kind: 'accept',
    label: 'Accept move to Intensification',
  });
  assert.equal(waiting.start.label, 'Start workout');
  // An old cached stay or deload offer that is still `pending`: no Accept, Start is not stranded.
  for (const phaseAction of ['stay', 'deload_recommended']) {
    const stale = planStartModel(
      input({ prescription: plan({ phaseAction }), prescriptionStatus: 'pending' }),
    )!;
    assert.equal(stale.suggestion, null);
    assert.equal(stale.start.label, 'Start workout');
    assert.ok(stale.link);
  }
  // Applied, the same move shows nothing to accept.
  const applied = planStartModel(
    input({
      prescription: plan({ phase: 'intensification', phaseAction: 'transition_recommended' }),
      prescriptionStatus: 'auto_applied',
    }),
  )!;
  assert.equal(applied.suggestion, null);
});

test('any other kind of program gets no model: its screen is unchanged', () => {
  assert.equal(planStartModel(input({ aiDynamic: false })), null);
});

test('a baseline day has no Deload link', () => {
  assert.equal(planStartModel(input({ isBaseline: true }))!.link, null);
});

test('rows: scheme, and an arrow only when the load changed since last time', () => {
  const model = planStartModel(
    input({
      exercises: [lift('up'), lift('same'), lift('down'), lift('new')],
      previousTops: { up: 80, same: 82.5, down: 85 },
    }),
  )!;
  const [up, same, down, fresh] = model.rows;
  assert.equal(up.scheme, '3 × 8 @ 82.5 kg');
  assert.deepEqual(up.change, { direction: 'up', amount: '2.5' });
  assert.equal(same.change, null);
  assert.deepEqual(down.change, { direction: 'down', amount: '2.5' });
  assert.equal(fresh.change, null);
});

test('a bodyweight lift reads in reps, with no load and no arrow', () => {
  const model = planStartModel(
    input({
      exercises: [
        lift('pull', {
          exerciseType: 'bodyweight',
          estimated1rm: null,
          lastWeights: [0],
        }),
      ],
    }),
  )!;
  assert.equal(model.rows[0].scheme, '3 × 8');
  assert.equal(model.rows[0].change, null);
});

test('a lift logged in pounds reads in pounds, and so does its change', () => {
  const model = planStartModel(
    input({ exercises: [lift('a')], units: { a: 'lb' }, previousTops: { a: 80 } }),
  )!;
  assert.equal(model.rows[0].scheme, '3 × 8 @ 181.9 lb');
  assert.deepEqual(model.rows[0].change, { direction: 'up', amount: '5.5' });
});

test('sets that differ read as a range', () => {
  const model = planStartModel(
    input({
      exercises: [
        lift('a', {
          sets: [
            { number: 1, reps: 8, percent: 75, restSeconds: 90 },
            { number: 2, reps: 6, percent: 85, restSeconds: 90 },
          ],
          setCount: 2,
          lastWeights: [],
        }),
      ],
    }),
  )!;
  assert.equal(model.rows[0].scheme, '2 × 6–8 @ 75–85 kg');
});

test('a lift note is kept whole, and hidden on a deloaded lift', () => {
  const note = '−7.5% load: effort ran high while your 1RM slipped, so today starts lighter than planned.';
  const prescription = plan({
    exercises: [
      { sessionExerciseId: 'a', autoregNote: note },
      { sessionExerciseId: 'b', autoregNote: note },
      { sessionExerciseId: 'c', autoregNote: '  ' },
    ],
  });
  const model = planStartModel(
    input({
      prescription,
      exercises: [lift('a'), lift('b', { deloaded: true }), lift('c'), lift('d')],
    }),
  )!;
  assert.equal(model.rows[0].note, note);
  assert.equal(model.rows[1].note, null);
  assert.equal(model.rows[2].note, null);
  assert.equal(model.rows[3].note, null);
});

test('done, injury, superset and deload marks come through', () => {
  const model = planStartModel(
    input({
      exercises: [lift('a', { supersetGroup: 1, deloaded: true }), lift('b')],
      completedIds: ['b'],
      injuredMuscles: ['chest'],
    }),
  )!;
  assert.equal(model.rows[0].superset, true);
  assert.equal(model.rows[0].deloaded, true);
  assert.equal(model.rows[0].injured, true);
  assert.equal(model.rows[1].done, true);
  assert.equal(model.rows[0].done, false);
});

test('the plan response carries each lift\'s note, and a malformed one is no note, not a refusal', async () => {
  const { periodizationSchema } = await import('../src/features/workouts/data/models.ts');
  const row = (extra: Record<string, unknown>) => ({
    sessionExerciseId: 'a',
    name: 'Bench',
    sets: 3,
    reps: 8,
    pct: 80,
    restSec: 120,
    ...extra,
  });
  const response = (exercises: unknown[]) => ({
    state: {
      phase: 'accumulation',
      prescriptionStatus: 'auto_applied',
      prescription: {
        phase: 'accumulation',
        phaseAction: 'stay',
        exercises,
        reasoning: 'ok',
        deload: false,
        estimatedSessionDurationMin: 60,
      },
    },
  });
  const parsed = periodizationSchema.parse(response([row({ autoregNote: '−5% load' })]));
  assert.equal(parsed.state?.prescription?.exercises[0].autoregNote, '−5% load');
  const bad = periodizationSchema.parse(response([row({ autoregNote: 7 })]));
  assert.equal(bad.state?.prescription?.exercises[0].autoregNote, undefined);
});

test('the pre-workout body no longer draws Accept, Dismiss, Regenerate, Advance phase or the Full / Deload switch', async () => {
  const { readFileSync } = await import('node:fs');
  const source = readFileSync(
    new URL('../src/features/workouts/components/PrescriptionControls.tsx', import.meta.url),
    'utf8',
  );
  for (const gone of ['"Dismiss"', "'dismiss'", 'Regenerate"', 'Advance phase', 'Intensity today', 'chooseDeload']) {
    assert.ok(!source.includes(gone), `${gone} is back on the screen`);
  }
  // Accept survives only as the waiting move's button, which the model decides.
  assert.ok(!source.includes('title="Accept"'));
});
