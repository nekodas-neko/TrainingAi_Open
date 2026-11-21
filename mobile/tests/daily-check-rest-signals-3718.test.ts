// #3718: the daily check now suggests rest on three signals of the AI prompt's rest-day rule. The
// server names them in `restSignals`; Preview keeps the known ones and Home's card words each.
import assert from 'node:assert/strict';
import test from 'node:test';
import { buildCatalog, readSavedCatalog } from '../src/features/workouts/catalog.ts';
import { deloadWhy } from '../src/features/home/data/recommendation-reasons.ts';
import { workoutFixture } from './workout-fixture.ts';

test('the rest signals ride from the response into the saved catalog, unknown ones dropped', () => {
  const f = workoutFixture();
  const next = {
    ...f.next,
    deloadOrRestRecommended: true,
    deloadStrength: 'recommended',
    consecutiveTrainingDays: 0,
    restSignals: ['spo2Low', 'somethingNewer', 'sleepAndHrvLow'],
  };
  const catalog = buildCatalog(f.meta, next, f.all, f.reader);
  assert.deepEqual(catalog.recommendation.restSignals, ['spo2Low', 'sleepAndHrvLow']);
  const saved = readSavedCatalog(JSON.stringify(catalog), f.reader);
  assert.deepEqual(saved?.recommendation.restSignals, ['spo2Low', 'sleepAndHrvLow']);
  assert.equal(buildCatalog(f.meta, { ...f.next, restSignals: 'x' }, f.all, f.reader).recommendation.restSignals, undefined);
});

test('the card says why for each new signal, with a cause beside the two choices', () => {
  const why = deloadWhy({
    deloadOrRestRecommended: true,
    deloadStrength: 'strong',
    consecutiveTrainingDays: 0,
    restSignals: ['readinessVeryLow', 'spo2Low'],
    signals: { ouraReadiness: 38, ouraReadinessModelVersion: 'v18:baseline-centre-75:2026-11-15' },
  });
  assert.equal(why.cause, 'Readiness very low');
  assert.deepEqual(why.reasons.map((r) => r.kind), ['readiness', 'spo2']);
  assert.equal(why.reasons[0].text, 'Readiness 38 — under 45, low enough that a rest day is the better call.');
  assert.equal(
    deloadWhy({ deloadOrRestRecommended: true, deloadStrength: 'recommended', restSignals: ['sleepAndHrvLow'] }).cause,
    'Sleep and HRV both low',
  );
});

test('Preview keeps exactly the kinds the shared decision defines', async () => {
  const { REST_SIGNAL_KINDS } = await import('@trainingai/shared/ai-periodization/daily-rest-decision');
  const { recommendationRestSignals } = await import('../src/features/workouts/catalog.ts');
  assert.deepEqual(recommendationRestSignals([...REST_SIGNAL_KINDS, 'somethingNewer']), [...REST_SIGNAL_KINDS]);
});
