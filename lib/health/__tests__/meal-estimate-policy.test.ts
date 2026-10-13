import { describe, it, expect } from 'vitest';
import { computeEnergyBalance } from '../energy-balance-service';
import type { WorkoutRepository } from '@/lib/data/repository';
const date = '2026-10-12';
function fixture(
  tracking: { mealTypeId: string; skipped: boolean; explicit?: boolean }[],
  loggedTypes = ['breakfast'],
) {
  return {
    listBodyMetrics: async () => [{ date, weightKg: 80 }],
    listFoodLogsSummary: async () => [{ date, calories: 1000 }],
    listActivityLogs: async () => [],
    getWorkoutSessionsFrom: async () => [],
    getNutritionTargets: async () => null,
    getUserGoals: async () => null,
    getUserById: async () => ({
      dateOfBirth: '1990-01-01',
      sex: 'male',
      heightCm: 180,
      fitnessGoal: 'maintain',
    }),
    listDayCheckins: async () => [],
    getBodyFatCalibration: async () => null,
    getLatestMeasuredRmr: async () => null,
    listDoseHistory: async () => [],
    getAvgBpmBySession: async () => new Map(),
    listMealLoggingCompleteness: async () => [],
    listMealLoggingStatuses: async () => tracking,
    listPlanMealAnswers: async () => [
      { planMealId: 'planned-lunch', answer: 'estimated', estCalories: 500 },
    ],
    getActiveMealPlan: async () => ({
      variants: [{ meals: [{ id: 'planned-lunch', mealTypeId: 'lunch' }] }],
    }),
    listMealTypes: async () => [{ id: 'breakfast' }, { id: 'lunch' }],
    listFoodLogs: async () => loggedTypes.map((mealTypeId) => ({ mealTypeId })),
  } as unknown as WorkoutRepository;
}
describe('meal-status calorie accounting', () => {
  it('keeps legacy plan assumptions separate from recorded intake', async () => {
    const result = await computeEnergyBalance(fixture([]), 'one', 'Australia/Brisbane', date);
    expect(result.balance?.loggedIntakeKcal).toBe(1000);
    expect(result.balance?.estimatedKcal).toBe(500);
    expect(result.balance?.intakeKcal).toBe(1500);
  });
  it.each([false, true])(
    'per-meal tracking excludes an unrecorded or skipped plan meal (skipped=%s)',
    async (skipped) => {
      const result = await computeEnergyBalance(
        fixture([{ mealTypeId: 'lunch', skipped, explicit: true }]),
        'one',
        'Australia/Brisbane',
        date,
      );
      expect(result.balance?.loggedIntakeKcal).toBe(1000);
      expect(result.balance?.estimatedKcal).toBe(0);
      expect(result.balance?.intakeKcal).toBe(1000);
    },
  );
  it('logging the real meal replaces its estimate instead of counting both', async () => {
    const result = await computeEnergyBalance(
      fixture([], ['breakfast', 'lunch']),
      'one',
      'Australia/Brisbane',
      date,
    );
    expect(result.balance?.estimatedKcal).toBe(0);
    expect(result.balance?.intakeKcal).toBe(1000);
  });
});
