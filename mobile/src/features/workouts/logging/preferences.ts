import { z } from 'zod';
import { kgToLbs, lbsToKg } from '@trainingai/shared/workout/units';

export const timerPreferencesSchema = z.object({
  warmup: z.boolean().default(true),
  setup: z.boolean().default(true),
  setElapsed: z.boolean().default(true),
  workoutElapsed: z.boolean().default(true),
  restCues: z.boolean().default(true),
  warmupSeconds: z.number().int().min(30).max(3600).nullable().default(null),
  setupSeconds: z.number().int().min(30).max(3600).nullable().default(null),
});
export type TimerPreferences = z.infer<typeof timerPreferencesSchema>;
export const defaultTimers = () => timerPreferencesSchema.parse({});
export const workoutPreferencesSchema = z.object({
  timers: timerPreferencesSchema.default(defaultTimers),
  units: z.record(z.string(), z.enum(['kg', 'lb'])).default({}),
});
export const defaultWorkoutPreferences = () => workoutPreferencesSchema.parse({});

export function displayLoad(kg: string | number, unit: 'kg' | 'lb') {
  if (String(kg).trim() === '' || !Number.isFinite(Number(kg))) {
    return '';
  }
  const value = unit === 'kg' ? Number(kg) : kgToLbs(Number(kg));
  return String(Math.round(value * 100) / 100);
}

/**
 * A load as read anywhere but the entry wheel, in the unit the lift is logged in (#4072). Stored
 * loads are exact kilograms; a pound lift reads to the nearest tenth of a pound ("22.5 lb", not
 * "10.21 kg" or "22.49 lb"), a kilogram lift to two decimals as before.
 */
export function loadLabel(kg: string | number, unit: 'kg' | 'lb' = 'kg') {
  if (unit === 'kg') {
    const text = displayLoad(kg, 'kg');
    return text === '' ? '' : `${text} kg`;
  }
  if (String(kg).trim() === '' || !Number.isFinite(Number(kg))) {
    return '';
  }
  // Round the magnitude and restore the sign, so an assistance (negative) tie rounds away from
  // zero like a positive one instead of toward it.
  const lb = kgToLbs(Number(kg));
  const tenths = Math.sign(lb) * (Math.round(Math.abs(lb) * 10) / 10);
  return `${tenths === 0 ? 0 : tenths} lb`;
}

/** The unit a lift is logged in: the one its set card's toggle last chose, kilograms until then. */
export function weightUnitOf(
  units: Record<string, 'kg' | 'lb'>,
  exerciseId: string | null | undefined,
): 'kg' | 'lb' {
  return (exerciseId ? units[exerciseId] : undefined) ?? 'kg';
}

export function storedLoad(value: string, unit: 'kg' | 'lb') {
  if (!/^-?\d+(\.\d+)?$/.test(value.trim())) {
    return value;
  }
  return String(unit === 'kg' ? Number(value) : lbsToKg(Number(value)));
}
