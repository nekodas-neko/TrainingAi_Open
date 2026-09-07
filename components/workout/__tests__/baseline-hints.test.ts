import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { baselineHint, hasAnyHint } from '@/components/workout/baseline-hints';
import { BW_REF, displayOneRm } from '@trainingai/shared/1rm';

// The owner's live row: `personal_records` holds Pull-Up estimated_1rm = 118.25, and
// `exercise_library.exercise_type` for Pull-Up is 'bodyweight'.
const PULL_UP_INDEX = 118.25;

describe('baselineHint — BF-127', () => {
  it('offers no kilograms for a bodyweight movement', () => {
    // The live defect: mround125(118.25 * 0.7) = 82.5, printed as "82.5 kg" — an instruction to
    // hang 82.5 kg from a pull-up bar, against a real body weight of 70.65 kg.
    const hint = baselineHint(PULL_UP_INDEX, 'bodyweight');
    expect(hint.kind).toBe('bodyweight');
    expect(JSON.stringify(hint)).not.toContain('82.5');
  });

  it('reports the rep max instead, through the shared resolver', () => {
    const hint = baselineHint(PULL_UP_INDEX, 'bodyweight');
    expect(hint).toEqual({ kind: 'bodyweight', repMax: displayOneRm(PULL_UP_INDEX, 'bodyweight').value });
  });

  it('does not invent a rep target from 70% of a rep max', () => {
    // Reps do not scale that way. The row reports what was earned, not a fraction of it.
    const full = displayOneRm(PULL_UP_INDEX, 'bodyweight').value;
    const hint = baselineHint(PULL_UP_INDEX, 'bodyweight');
    expect(hint.kind === 'bodyweight' && hint.repMax).toBe(full);
  });

  it('still suggests a load for a weighted movement, unchanged', () => {
    // 92.5 * 0.7 = 64.75 → mround125 → 65. The number on screen today must not move.
    expect(baselineHint(92.5, 'weighted')).toEqual({ kind: 'load', kg: 65 });
    expect(baselineHint(92.5, null)).toEqual({ kind: 'load', kg: 65 });
  });

  it('says so when there is no stored 1RM at all', () => {
    expect(baselineHint(null, 'weighted')).toEqual({ kind: 'unknown' });
    expect(baselineHint(undefined, null)).toEqual({ kind: 'unknown' });
  });

  it('still shows a bodyweight row when its rep max is unknown', () => {
    // "Bodyweight" is true and useful even with no history; "enter manually" would not be.
    expect(baselineHint(null, 'bodyweight')).toEqual({ kind: 'bodyweight', repMax: null });
  });

  it('shows the block when any row has something to say', () => {
    expect(hasAnyHint([{ kind: 'unknown' }, { kind: 'bodyweight', repMax: null }])).toBe(true);
    expect(hasAnyHint([{ kind: 'unknown' }])).toBe(false);
    expect(hasAnyHint([])).toBe(false);
  });
});

describe('the premise: a bodyweight 1RM is not kilograms', () => {
  it('is an index against a fixed reference, not the lifter body weight', () => {
    // BW_REF is why 118.25 exceeds the owner's 70.65 kg and still means something. If this ever
    // becomes the real body weight, the whole basis of this fix changes and the guard should fail.
    expect(BW_REF).toBe(100);
  });

  it('and the shared resolver is what says so', () => {
    expect(displayOneRm(PULL_UP_INDEX, 'bodyweight').unit).toBe('RM');
    expect(displayOneRm(PULL_UP_INDEX, 'weighted').unit).toBe('kg');
  });
});

const code = (s: string) =>
  s.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
const src = (rel: string) => code(readFileSync(path.resolve(__dirname, '../..', rel), 'utf8'));

describe('the banner no longer hardcodes a unit', () => {
  const banner = src('workout/ai-baseline-banner.tsx');

  it('has no bare "kg" on a value it did not resolve', () => {
    expect(banner, 'the hardcoded unit is the defect').not.toMatch(/suggestedWeightKg/);
    expect(banner).not.toMatch(/Suggested starting weights/);
  });

  it('renders each row through the hint union', () => {
    expect(banner).toMatch(/hint\.kind === 'load'/);
    expect(banner).toMatch(/hint\.kind === 'bodyweight'/);
  });

  it('and the call site reads the exercise type', () => {
    const screen = src('workout/pre-workout-screen.tsx');
    expect(screen).toMatch(/baselineHint\(ex\.current1rm, baselineTypeById\.get\(ex\.sessionExerciseId\)\)/);
    expect(screen, 'the 70% multiplication moved into the resolver').not.toMatch(/current1rm \* 0\.7/);
  });
});
