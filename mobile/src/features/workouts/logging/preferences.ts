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

export function storedLoad(value: string, unit: 'kg' | 'lb') {
  if (!/^-?\d+(\.\d+)?$/.test(value.trim())) {
    return value;
  }
  return String(unit === 'kg' ? Number(value) : lbsToKg(Number(value)));
}
