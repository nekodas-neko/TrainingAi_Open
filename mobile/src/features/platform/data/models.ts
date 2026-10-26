import { z } from 'zod';
export const reminderKinds = [
  'workout',
  'meal',
  'supplement',
  'review',
  'week',
  'health',
] as const;
export const reminderLabels = {
  workout: 'Workout',
  meal: 'Meal',
  supplement: 'Supplement',
  review: 'Day review',
  week: 'Week review',
  health: 'Health check-in',
};
export const reminderSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(reminderKinds),
  title: z.string().trim().min(1).max(100),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  days: z.array(z.number().int().min(0).max(6)).min(1).max(7),
  enabled: z.boolean().default(true),
});
export type Reminder = z.infer<typeof reminderSchema>;
export const platformSchema = z
  .object({
    scope: z.string().min(1),
    restAlerts: z.boolean().default(false),
    walkCues: z.boolean().default(false),
    keepAwake: z.boolean().default(true),
    reminders: z.array(reminderSchema).max(12).default([]),
    calendarId: z.string().nullable().default(null),
    calendarTitle: z.string().nullable().default(null),
    calendarAuto: z.boolean().default(false),
    calendarSince: z.number().default(0),
    // Morning hand-off to the Oura app (#2896): the setting, the local day it last ran, and the
    // day TrainingAi could not come back from Oura (which turned the setting off). Off by default
    // until the hand-off is proven on the phone and the ring has moved to the Oura API (#2808).
    ouraMorningSync: z.boolean().default(false),
    ouraHandoffDay: z.string().nullable().default(null),
    ouraHandoffStrandedDay: z.string().nullable().default(null),
  })
  .refine(
    (settings) =>
      settings.reminders
        .filter((row) => row.enabled)
        .reduce((sum, row) => {
          const days = new Set(row.days).size;
          return sum + (days === 7 ? 1 : days);
        }, 0) <= 32,
    'Choose fewer reminder days to leave room for workout and walk alerts.',
  );
export type PlatformSettings = z.infer<typeof platformSchema>;
export type Alert = {
  id: string;
  scope: string;
  title: string;
  body: string;
  target: 'workout' | 'walk' | 'nutrition' | 'health' | 'review' | 'week';
  recordId?: string;
  restCueId?: string;
  /** A meal reminder that carries the answer actions (#2123): the plan meal and its local day. */
  mealEstimate?: { planMealId: string; date: string };
  zone?: string;
  trigger: { at: number } | { hour: number; minute: number; weekday?: number };
};
export const ALERT_OWNER = 'trainingai-native-v1';
export function alertSignature(alert: Alert) {
  return JSON.stringify(alert);
}
