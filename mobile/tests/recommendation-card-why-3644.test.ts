// #3644, #3330, #2204: Preview's recommendation card says why rest is suggested, the Full/Deload
// toggle says what the other side changes, and Start swipes to reveal Rest on an ordinary day.
// The words come from the daily check's answer, through the shared `deload-reasons`.
import assert from 'node:assert/strict';
import test from 'node:test';
import { buildCatalog, readSavedCatalog } from '../src/features/workouts/catalog.ts';
import {
  dailyCheckStrip,
  deloadWhy,
  recommendationControls,
  recommendationStrip,
  restDayCardModel,
} from '../src/features/home/data/recommendation-reasons.ts';
import type { RecommendationModel } from '../src/features/home/data/recommendation-model.ts';
import { intensityToggleModel } from '../src/features/workouts/data/intensity-toggle.ts';
import { workoutFixture } from './workout-fixture.ts';

const session = { kind: 'session', state: 'recommended' } as RecommendationModel;
const tempDay = {
  deloadOrRestRecommended: true,
  deloadStrength: 'recommended' as const,
  temperatureAlert: true,
  consecutiveTrainingDays: 2,
  signals: {
    temperatureDeviation: 0.62,
    temperatureAlertThresholdC: 0.5,
    temperatureBaselineDays: 40,
    ouraReadiness: 61,
    energyLevel: 'low',
  },
};

test('the strip says the temperature first, coloured by strength', () => {
  assert.deepEqual(recommendationStrip(tempDay, session), {
    message: 'Body temp elevated — rest or deload recommended',
    strength: 'recommended',
    icon: 'thermometer',
  });
});

test('the strip names a long streak, and a broken rest streak', () => {
  const streak = { deloadOrRestRecommended: true, deloadStrength: 'strong' as const, consecutiveTrainingDays: 5 };
  assert.equal(
    recommendationStrip(streak, session)?.message,
    '5 sessions in a row — rest or deload recommended today',
  );
  assert.equal(recommendationStrip(streak, session)?.icon, 'alert');
  assert.equal(
    recommendationStrip({ ...streak, deloadStrength: 'soft' }, session)?.message,
    '5 sessions in a row — consider a rest soon',
  );
  assert.equal(
    recommendationStrip({ ...streak, streakBroken: true, consecutiveRestDays: 3 }, session)?.message,
    '3 rest days — resting today breaks your streak',
  );
});

test('no strip on an ordinary day, or under four training days without a temperature', () => {
  assert.equal(recommendationStrip({ deloadOrRestRecommended: false, consecutiveTrainingDays: 6 }, session), null);
  assert.equal(recommendationStrip({ deloadOrRestRecommended: true, consecutiveTrainingDays: 3 }, session), null);
  assert.equal(recommendationStrip(undefined, session), null);
});

test('the strip shows before the check-in and on a suggested card, never over a finished or chosen day', () => {
  assert.ok(recommendationStrip(tempDay, { kind: 'checkin', session: undefined }));
  for (const model of [
    { kind: 'session', state: 'done' },
    { kind: 'session', state: 'active' },
    { kind: 'rest', reason: '' },
    { kind: 'none' },
    { kind: 'loading' },
  ] as RecommendationModel[]) {
    assert.equal(recommendationStrip(tempDay, model), null, model.kind);
  }
  // The pre-workout screen shows the same call whatever Home is doing.
  assert.equal(dailyCheckStrip(tempDay)?.message, 'Body temp elevated — rest or deload recommended');
});

test('"Why this recommendation?" lists only reasons a real input backs', () => {
  const why = deloadWhy(tempDay);
  assert.equal(why.cause, 'Body temp elevated');
  assert.equal(why.headline, 'Recovery is recommended today.');
  assert.deepEqual(
    why.reasons.map((reason) => reason.kind),
    ['temperature', 'readiness', 'energy'],
  );
  assert.match(why.reasons[0].text, /^\+0\.6°C above your baseline \(threshold 0\.5°C\) — based on 40 nights/);
  assert.match(why.reasons[1].text, /^Readiness 61 — below the 76\+ range/);
  assert.equal(why.reasons[2].text, 'You checked in feeling low on energy this morning.');
  // A soft nudge has no cause line; a long streak is a reason.
  const soft = deloadWhy({ deloadOrRestRecommended: true, deloadStrength: 'soft', consecutiveTrainingDays: 4 });
  assert.equal(soft.cause, null);
  assert.deepEqual(soft.reasons.map((reason) => reason.kind), ['streak']);
  // A drained check-in with no streak names no streak.
  const drained = deloadWhy({ deloadOrRestRecommended: true, deloadStrength: 'strong', consecutiveTrainingDays: 0 });
  assert.equal(drained.cause, null);
  assert.equal(
    deloadWhy({ deloadOrRestRecommended: true, deloadStrength: 'strong', consecutiveTrainingDays: 5 }).cause,
    '5 sessions in a row',
  );
});

test('no soreness, HRV or sleep-trend line (#3804, #3837)', () => {
  const why = deloadWhy({
    deloadOrRestRecommended: true,
    deloadStrength: 'recommended',
    consecutiveTrainingDays: 1,
    signals: { ouraReadiness: 90, energyLevel: 'good' },
  });
  assert.deepEqual(why.reasons, []);
});

test('the Rest Day card carries the shared guidance and the bedtime on a rest-fully day', () => {
  const card = restDayCardModel({
    readiness: {
      readinessDisplayScore: 52,
      sleepScore: 30,
      sleepScoreDate: '2026-11-21',
      recommendedBedtimeStart: 1305,
    },
    soreMuscles: [],
    consecutiveRestDays: 0,
    today: '2026-11-21',
  });
  assert.equal(card.band, 'rest');
  assert.equal(card.title, 'Rest fully');
  assert.equal(card.bedtime, '9:45 pm');
  assert.ok(card.suggestions.length > 0);
});

test('no bedtime unless the band is rest, and an older night is not last night', () => {
  const card = restDayCardModel({
    readiness: { readinessDisplayScore: 90, sleepScore: 30, sleepScoreDate: '2026-11-15', recommendedBedtimeStart: 1305 },
    soreMuscles: [],
    consecutiveRestDays: 0,
    today: '2026-11-21',
  });
  assert.notEqual(card.band, 'rest');
  assert.equal(card.bedtime, null);
  assert.ok(!card.suggestions.some((line) => /sleep score/i.test(line)));
  const none = restDayCardModel({ readiness: null, soreMuscles: [], consecutiveRestDays: null, today: '2026-11-21' });
  assert.equal(none.lowConfidence, true);
});

test('Start swipes to Rest on an ordinary day; a suggested day keeps both buttons', () => {
  assert.equal(recommendationControls('start'), 'start-swipe-rest');
  assert.equal(recommendationControls('deload'), 'rest-and-full');
  assert.equal(recommendationControls('resume'), 'resume');
  assert.equal(recommendationControls('completed'), 'completed');
});

test('the catalog keeps the deload grade and the signals the reasons read', () => {
  const f = workoutFixture();
  const next = {
    ...f.next,
    deloadOrRestRecommended: true,
    deloadStrength: 'strong',
    signals: {
      ouraReadiness: 40,
      ouraReadinessModelVersion: 'v18',
      energyLevel: 'drained',
      temperatureDeviation: null,
      temperatureBaselineDays: 12,
      temperatureAlertThresholdC: 0.5,
      soreMuscles: ['quads'],
      hrvTrend: 0.7,
    },
  };
  const catalog = buildCatalog(f.meta, next, f.all, f.reader);
  assert.equal(catalog.recommendation.deloadStrength, 'strong');
  assert.deepEqual(catalog.recommendation.signals, {
    ouraReadiness: 40,
    temperatureDeviation: null,
    temperatureBaselineDays: 12,
    temperatureAlertThresholdC: 0.5,
    ouraReadinessModelVersion: 'v18',
    energyLevel: 'drained',
  });
  const saved = readSavedCatalog(JSON.stringify(catalog), f.reader);
  assert.equal(saved?.recommendation.deloadStrength, 'strong');
  assert.equal(saved?.recommendation.signals?.energyLevel, 'drained');
});

test('an unknown grade from another server is left out, and a corrupt saved one is refused', () => {
  const f = workoutFixture();
  const catalog = buildCatalog(f.meta, { ...f.next, deloadStrength: 'extreme', signals: 'x' }, f.all, f.reader);
  assert.equal(catalog.recommendation.deloadStrength, undefined);
  assert.equal(catalog.recommendation.signals, undefined);
  const corrupt = { ...catalog, recommendation: { ...catalog.recommendation, deloadStrength: 'extreme' } };
  assert.equal(readSavedCatalog(JSON.stringify(corrupt), f.reader), null);
});

const style = [{}];
const deloadList = [
  { name: 'Squat', deloaded: true, preDeloadStyle: style },
  { name: 'Leg Press', deloaded: true, preDeloadStyle: style },
  { name: 'Calf Raise', deloaded: true, preDeloadStyle: null },
  { name: 'Leg Curl', deloaded: false },
];
const deloadPlan = {
  deload: true,
  phase: 'deload',
  reasoning: 'Fatigue has built up over five sessions.',
  estimatedSessionDurationMin: 38,
  fullSession: { estimatedSessionDurationMin: 52 },
};

test('on Deload the line says what Full changes before the flip, naming what stays light', () => {
  const model = intensityToggleModel({
    prescription: deloadPlan,
    exercises: deloadList,
    deloadChosen: true,
    suggestedToday: true,
  });
  assert.equal(
    model.difference,
    'Full is 2 exercises heavier and about 14 min longer. Calf Raise stays light: no full numbers yet.',
  );
  assert.deepEqual(model.staysLight, ['Calf Raise']);
  assert.deepEqual(model.card, {
    heading: 'Deload session',
    reason: 'Fatigue has built up over five sessions.',
    minutes: 38,
  });
  assert.equal(model.fullLabel, 'Full · Override');
  assert.equal(model.deloadLabel, 'Deload · As prescribed');
});

test('on Full the heading, reason and minutes follow the toggle', () => {
  const model = intensityToggleModel({
    prescription: deloadPlan,
    exercises: deloadList,
    deloadChosen: false,
    suggestedToday: false,
  });
  assert.equal(model.difference, 'Deload is 2 exercises lighter and about 14 min shorter.');
  assert.deepEqual(model.card, {
    heading: 'Full session',
    reason: 'The deload is skipped today: this runs your full numbers.',
    minutes: 52,
  });
});

test('a training plan: Deload is labelled "Suggested today" only when the daily check says so', () => {
  const plan = { phase: 'accumulation', reasoning: 'Squat goes up 2.5 kg.', estimatedSessionDurationMin: 50 };
  const full = intensityToggleModel({
    prescription: plan,
    exercises: [{ name: 'Squat', deloaded: false }],
    deloadChosen: false,
    suggestedToday: true,
  });
  assert.equal(full.deloadLabel, 'Deload · Suggested today');
  assert.equal(full.fullLabel, 'Full · As prescribed');
  assert.equal(full.difference, 'Deload lightens the loads for this session only.');
  assert.deepEqual(full.card, { heading: 'Accumulation', reason: 'Squat goes up 2.5 kg.', minutes: 50 });
  const ordinary = intensityToggleModel({ prescription: plan, exercises: [], deloadChosen: false, suggestedToday: false });
  assert.equal(ordinary.deloadLabel, 'Deload · Lighter loads');
  // Deload chosen over a training plan: the server's deloaded list arrives with full numbers.
  const chosen = intensityToggleModel({
    prescription: plan,
    exercises: [{ name: 'Squat', deloaded: true, preDeloadStyle: style }],
    deloadChosen: true,
    suggestedToday: true,
  });
  assert.equal(chosen.difference, 'Full is 1 exercise heavier.');
  assert.deepEqual(chosen.card, {
    heading: 'Deload session',
    reason: 'Lighter loads today, in place of the prescribed session.',
    minutes: 50,
  });
});

test('every exercise without full numbers: Full is named as keeping them light', () => {
  const model = intensityToggleModel({
    prescription: deloadPlan,
    exercises: [
      { name: 'Calf Raise', deloaded: true },
      { name: 'Dip', deloaded: true, preDeloadStyle: [] },
    ],
    deloadChosen: false,
    suggestedToday: false,
  });
  assert.equal(model.difference, 'Full keeps Calf Raise and Dip light: no full numbers yet.');
  assert.equal(intensityToggleModel({ prescription: null, exercises: [], deloadChosen: false, suggestedToday: false }).card, null);
});
