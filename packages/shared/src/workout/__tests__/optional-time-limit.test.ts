import { describe, it, expect } from 'vitest';
import {
  budgetForPreset,
  workingBudgetMin,
  durationDirection,
  sessionTimeLimitOptions,
  warmupGoalSecFor,
} from '../duration-model';
import {
  allocateToBudget,
  fitToBudget,
  dropToBudget,
  expandToBudget,
} from '../../ai-periodization/time-budget';
import { applyBudgetStage } from '../../ai-periodization/budget-stage';
import type { PrescriptionSignals } from '../../ai-periodization/signals';

const exercises = Array.from({ length: 8 }, (_, index) => ({
  sessionExerciseId: `exercise-${index}`,
  name: `Exercise ${index}`,
  role: index === 0 ? 'primary' : 'accessory',
  sets: 3,
  reps: 10,
  pct: 70,
  restSec: 180,
  transitionSec: 240,
}));
const signals = (budget: number) =>
  ({
    trainingGoal: 'hypertrophy',
    effectiveTimeBudgetMin: budget,
    exercises: exercises.map((ex) => ({
      ...ex,
      muscleAssignments: [{ muscle: 'quads', role: 'main' }],
      timeProfile: null,
    })),
    weeklyTargets: {},
    weeklyLogged: {},
  }) as unknown as PrescriptionSignals;

describe('optional session time limit', () => {
  it('has no hidden default or minimum when explicitly disabled', () => {
    expect(workingBudgetMin(0, 10)).toBe(0);
    expect(budgetForPreset(60, 0)).toBe(0);
    expect(budgetForPreset(0, 'standard')).toBe(0);
    expect(budgetForPreset(30, 'short')).toBe(20);
    expect(durationDirection(30, 'short')).toBe(-1);
    expect(durationDirection(60, 0)).toBe(0);
    expect(durationDirection(0, 30)).toBe(-1);
    expect(sessionTimeLimitOptions(0)).toEqual([30, 45, 60, 90, 0]);
    expect(warmupGoalSecFor(0, 'standard')).toBeNull();
    expect(warmupGoalSecFor(0, 30)).toBe(warmupGoalSecFor(30, 'standard'));
  });
  it('all budget allocators preserve the full exercise shape when off', () => {
    expect(allocateToBudget(exercises, 0)).toEqual({ exercises, droppedIds: [] });
    expect(fitToBudget(exercises, 0)).toEqual(exercises);
    expect(dropToBudget(exercises, 0)).toEqual({ exercises, droppedIds: [], pairFitIds: [] });
    expect(expandToBudget(exercises, 0)).toEqual(exercises);
  });
  it('a session longer than 60 minutes keeps its work and rests, without over-budget warnings', () => {
    const result = applyBudgetStage(exercises, signals(0), 0, 'standard', new Set());
    expect(result.estimatedSessionDurationMin).toBeGreaterThan(60);
    expect([...result.sets.values()]).toEqual(Array(8).fill(3));
    expect([...result.restSec.values()]).toEqual(Array(8).fill(180));
    expect(result.droppedIds.size).toBe(0);
    expect(result.budgetNote).toBe('');
    const limited = applyBudgetStage(exercises, signals(workingBudgetMin(30)), 0, 30, new Set());
    expect(limited.droppedIds.size).toBeGreaterThan(0);
  });
});
