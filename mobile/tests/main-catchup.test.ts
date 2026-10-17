import assert from 'node:assert/strict';
import test from 'node:test';
import { trainingStressSpec } from '../src/features/workouts/data/models.ts';
import { intradayHrContributors } from '@trainingai/shared/health/intraday-hr-contributors';
import {
  hrMaxFromAge,
  zoneMaxFromTests,
  moderateIntensityBpm,
  vigorousIntensityBpm,
} from '@trainingai/shared/health/hr-zones';
import { resolveDayMetPerMinute } from '@trainingai/shared/health/met-input';
import { recordedIntake } from '../src/features/nutrition/data/recorded-intake.ts';

test('native cached training stress retains unmeasured coverage and the resting-HR date', () => {
  const data = trainingStressSpec('2026-10-12').schema.parse({
    status: 'ok',
    ots: 1.4,
    high: false,
    residualShare: 0.12,
    rhrFromDay: '2026-10-10',
  });
  assert.equal(data.status, 'ok');
  assert.equal(data.residualShare, 0.12);
  assert.equal(data.status === 'ok' ? data.rhrFromDay : null, '2026-10-10');
  assert.equal(
    trainingStressSpec('2026-10-12').schema.parse({
      status: 'gated',
      reason: 'insufficient_met',
      residualShare: 0.9,
    }).residualShare,
    0.9,
  );
});

test('native zones inherit the Cooper/age blend and a single vigorous reserve threshold', () => {
  const max = zoneMaxFromTests(hrMaxFromAge(33), [
    { testType: 'cooper12', date: '2026-10-10', maxHr: 175 },
  ]);
  assert.equal(max.maxHr, 181);
  assert.equal(moderateIntensityBpm({ maxHr: max.maxHr, restingHr: 55 }), 105);
  assert.equal(vigorousIntensityBpm({ maxHr: max.maxHr, restingHr: 55 }), 131);
});

test('native Apple Health and Health Connect sparse HR cannot become an inactivity score', () => {
  for (const source of ['apple_health', 'health_connect']) {
    const input = {
      hrRows: [{ timestamp: new Date('2026-10-12T00:00:00Z'), bpm: 90, source }],
      maxHr: 181,
      restingHr: 55,
      tz: 'Australia/Brisbane',
      dateIso: '2026-10-12',
    };
    assert.deepEqual(intradayHrContributors(input), {
      zoneMinutes: null,
      moveHours: null,
      moveHoursGoal: null,
    });
  }
});

test('native imported movement supplies MET while unmeasured minutes remain absent', () => {
  const from = Date.parse('2026-10-12T00:00:00Z');
  const result = resolveDayMetPerMinute(
    {
      ringGrid: { startTimestampMs: from, metsPerMinute: [] },
      ringStillFramesMs: [],
      sleepSessions: [],
      activities: [],
      weightKg: 70,
      activeKcal: [
        { startMs: from, endMs: from + 10 * 60000, kcal: 24.5, source: 'com.test.watch' },
      ],
    },
    from,
    from + 20 * 60000,
  );
  assert.equal(result.mix.provided, 10);
  assert.equal(result.mix.missing, 10);
  assert.equal(result.metsPerMinute[0], 3);
  assert.equal(result.metsPerMinute[19], null);
});

test('an estimate total without per-meal rows is never added on top of native logged totals', () => {
  const result = recordedIntake({
    calories: 500,
    hasLogs: true,
    pending: false,
    allSkipped: false,
    balance: {
      intakeKcal: 900,
      loggedIntakeKcal: 500,
      estimatedKcal: 400,
      budgetKcal: 1800,
      expenditureKcal: 1900,
    },
  });
  assert.equal(result.intake, 500);
  assert.equal(result.remaining, 1300);
  assert.equal(result.net, -1400);
});
