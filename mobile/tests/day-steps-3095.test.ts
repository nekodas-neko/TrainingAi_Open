// #3095: Preview pre-filled its steps log with today's treadmill-inclusive figure, and its overlay
// assigned a logged step count straight onto `steps`, dropping the treadmill session until readback.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { logSeedReading } from '@trainingai/shared/health/activity-steps';
import { overlayBody, type HealthOperation } from '../src/features/health/data/HealthStore.ts';
import { bodySpec } from '../src/features/health/data/models.ts';

const date = '2026-10-10';
// The route's shape on a treadmill day: 9,000 from the ring, 3,500 from the session.
const body = () =>
  bodySpec(date).schema.parse({
    today: { date, steps: 12_500, deviceSteps: 9_000, bodyFat: 25.3, bodyFatCorrected: 28.5 },
    recent: [{ date, steps: 12_500, deviceSteps: 9_000 }],
    latestWeightKg: null,
    latestWeightDate: null,
    activeEnergyKcalToday: null,
    weekToDate: { steps: 12_500, calories: 0, waterMl: 0 },
  });
const logSteps = (steps: number) =>
  ({ domain: 'body_metrics', date, payload: { steps }, acknowledged: false, attempted: false }) as unknown as HealthOperation;

test('the steps log seeds the ring count, not the treadmill-inclusive figure', () => {
  assert.equal(logSeedReading('steps', body().today), 9_000);
});

test('body fat still seeds the raw reading', () => {
  assert.equal(logSeedReading('bodyFat', body().today), 25.3);
});

test('a row with no indoor steps seeds its own steps', () => {
  assert.equal(logSeedReading('steps', { date, steps: 9_000 }), 9_000);
});

test('logging steps replaces the ring count and keeps the treadmill session', () => {
  const after = overlayBody(body(), [logSteps(10_000)], date)!;
  assert.equal(after.today!.steps, 13_500);
  assert.equal(after.today!.deviceSteps, 10_000);
  assert.equal(after.weekToDate!.steps, 13_500);
});

test('logging steps on a day without indoor steps is a plain replacement', () => {
  const plain = bodySpec(date).schema.parse({
    today: { date, steps: 9_000 }, recent: [{ date, steps: 9_000 }],
    latestWeightKg: null, latestWeightDate: null, activeEnergyKcalToday: null,
    weekToDate: { steps: 9_000, calories: 0, waterMl: 0 },
  });
  const after = overlayBody(plain, [logSteps(10_000)], date)!;
  assert.equal(after.today!.steps, 10_000);
  assert.equal(after.today!.deviceSteps, undefined);
  assert.equal(after.weekToDate!.steps, 10_000);
});
