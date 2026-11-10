// #3716: an expired prescription still showed on Preview's workout screen and pre-selected Deload.
// Preview talks to production (1.518.0), which sends no `prescriptionAgedOut`, so the client reads
// the expiry itself and the new field stays optional.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  hidePrescriptionAgedOutOnScreen,
  prescribedDeloadDefault,
} from '@trainingai/shared/ai-periodization/prescription-expiry';
import { periodizationSchema } from '../src/features/workouts/data/models.ts';

const HOUR = 3_600_000;
const response = (state: Record<string, unknown>) => ({
  state: {
    phase: 'deload',
    prescriptionStatus: 'pending',
    prescription: {
      phase: 'deload',
      phaseAction: 'deload_recommended',
      exercises: [],
      reasoning: 'Sick today.',
      deload: true,
      estimatedSessionDurationMin: 30,
    },
    ...state,
  },
});

test('a production response without the new fields still parses', () => {
  const parsed = periodizationSchema.parse(response({}));
  assert.equal(parsed.state?.prescriptionAgedOut, undefined);
  assert.equal(parsed.state?.prescription?.deload, true);
});

test('an unexpected expiry value does not break the card', () => {
  const parsed = periodizationSchema.parse(response({ prescriptionExpiresAt: 42 }));
  assert.equal(parsed.state?.prescriptionExpiresAt, null);
});

test('an illness deload that ended at midnight is neither the card nor the Deload default', () => {
  const state = periodizationSchema.parse(
    response({ prescriptionExpiresAt: new Date(Date.now() - HOUR).toISOString() }),
  ).state!;
  assert.equal(hidePrescriptionAgedOutOnScreen(state).prescription, null);
  assert.equal(prescribedDeloadDefault(state), false);
});

test('a newer server that leaves the prescription out and flags it reads Full', () => {
  const state = periodizationSchema.parse(
    response({ prescription: null, prescriptionAgedOut: true }),
  ).state!;
  assert.equal(prescribedDeloadDefault(state), false);
});

test('a live deload is still the card and the default (control)', () => {
  const state = periodizationSchema.parse(
    response({ prescriptionExpiresAt: new Date(Date.now() + HOUR).toISOString() }),
  ).state!;
  assert.equal(hidePrescriptionAgedOutOnScreen(state), state);
  assert.equal(prescribedDeloadDefault(state), true);
});
