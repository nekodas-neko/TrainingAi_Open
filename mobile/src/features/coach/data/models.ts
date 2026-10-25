import { z } from 'zod';
import type { UIMessage } from 'ai';
import type { ResourceSpec } from '../../workouts/data/WorkoutResources.ts';
import { aiFailureText } from '../../account/api/client.ts';

export const scopes = ['general', 'nutrition'] as const;
export type CoachScope = (typeof scopes)[number];
export const messageSchema = z
  .object({
    id: z.string(),
    role: z.enum(['user', 'assistant']),
    parts: z.array(z.object({ type: z.string() }).passthrough()).max(80),
  })
  .transform((value) => value as unknown as UIMessage);
export const conversationSchema = z.object({
  localId: z.uuid().optional(),
  stopped: z.boolean().default(false),
  input: z.string().max(12000),
  threadId: z.uuid().nullable(),
  messages: z.array(messageSchema).max(120),
});
export const archiveSchema = z
  .array(
    z.object({
      id: z.uuid(),
      updatedAt: z.string(),
      title: z.string(),
      frame: conversationSchema,
    }),
  )
  .max(20);
export type LocalThread = z.infer<typeof archiveSchema>[number];
export const emptyConversation = { input: '', threadId: null, messages: [] as UIMessage[] };
export const historySchema = z.object({
  threads: z.array(
    z.object({
      id: z.uuid(),
      title: z.string(),
      updatedAt: z.string(),
      messageCount: z.number(),
    }),
  ),
  changes: z.array(
    z.object({
      id: z.uuid(),
      summary: z.string(),
      appliedAt: z.string(),
      undoneAt: z.string().nullable(),
    }),
  ),
});
export const historySpec: ResourceSpec<z.infer<typeof historySchema>> = {
  path: '/api/coach/threads',
  schema: historySchema,
  ttl: 300000,
};
export const previewSchema = z.object({
  consequences: z.array(z.object({ kind: z.enum(['warn', 'info', 'good']), text: z.string() })),
  drift: z.array(
    z.object({
      changeId: z.string(),
      field: z.string(),
      expected: z.string(),
      actual: z.string(),
    }),
  ),
  target: z.object({ id: z.string().nullable(), label: z.string() }).nullable(),
});
export const applySchema = z.object({ changeId: z.uuid(), summary: z.string() });
export const coachPaths = [
  '/api/coach/threads',
  '/api/coach/options',
  '/api/user/goals',
  '/api/user/profile',
  '/api/workout-data',
  '/api/workout-templates',
  '/api/program-week',
  '/api/phase-sets',
  '/api/injuries',
  '/api/ai-periodization',
  '/api/next-session',
  '/api/progression-styles',
  '/api/muscle-recovery',
  '/api/collection',
  '/api/user/preferences',
  '/api/day-timeline',
  '/api/readiness-score',
  '/api/nutrition/targets',
  '/api/nutrition-goals',
  '/api/readiness',
  '/api/body-battery',
  '/api/day-log',
  '/api/calendar',
  '/api/goal-recommendations',
];
export function coachError(error: unknown, action = 'get a reply') {
  if ((error as { code?: string })?.code === 'pending_local_changes')
    return 'Finish uploading your saved changes before applying this suggestion.';
  const status = (error as { status?: number })?.status;
  if (status === 409) return 'This suggestion is out of date. Ask Coach for a fresh one.';
  if (status === 401 || status === 403)
    return 'Check your sign-in and account access to use Coach.';
  if (status === 429) return 'Coach is busy. Wait a moment, then retry.';
  if (status === 400) return 'Coach could not use this suggestion. Ask for a fresh one.';
  return aiFailureText(error, `Could not ${action}. Check your connection and retry.`);
}
export function when(iso: string, timezone: string) {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      timeZone: timezone,
      day: 'numeric',
      month: 'short',
    });
  } catch {
    return 'Date unavailable';
  }
}
export function stripToolCitations(text: string) {
  return text.replace(/\s*\[\s*(?:default_api:[\w.]+\s*,?\s*)+\]\s*\.?/g, '').trimEnd();
}
