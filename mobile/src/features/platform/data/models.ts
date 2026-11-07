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
    // A guided walk's and a test's block-change cues. On by default: the current app always cues
    // (#3647). `walkCuesDefaultOn` marks settings saved since then; `PlatformStore` turns the cues on
    // once for settings saved before, when the opt-in default left them off.
    walkCues: z.boolean().default(true),
    walkCuesDefaultOn: z.literal(true).default(true),
    keepAwake: z.boolean().default(true),
    reminders: z.array(reminderSchema).max(12).default([]),
    calendarId: z.string().nullable().default(null),
    calendarTitle: z.string().nullable().default(null),
    calendarAuto: z.boolean().default(false),
    calendarSince: z.number().default(0),
    // Morning hand-off to the Oura app (#2896): the setting, the local day it last ran, and the
    // day TrainingAi could not come back from Oura (which turned the setting off). Off by default
    // until the hand-off is proven on the phone and the ring has moved to the Oura API (#2808).
    // Illness / high-stress / low-readiness alerts on app open and resume. On by default, as in the
    // current app (#2843).
    healthAlerts: z.boolean().default(true),
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
/** What a health anomaly alert opens on a tap: the readiness view, as the current app's `/health/readiness` does (#3541). */
export const HEALTH_ALERT_TARGET = 'health-readiness';
/** True for a notification the scheduler plans, lists and may cancel. */
export const isSchedulerAlert = (data: Record<string, unknown> | undefined | null) =>
  data?.owner === ALERT_OWNER;
/**
 * True for a notification whose tap the app routes: the planned alerts, and a health alert, which
 * the scheduler never owns (a reconcile would cancel it) and so carries its own marker (#3541).
 */
export const isRoutableAlert = (data: Record<string, unknown> | undefined | null) =>
  isSchedulerAlert(data) || typeof data?.healthAlert === 'string';
export function alertSignature(alert: Alert) {
  return JSON.stringify(alert);
}
