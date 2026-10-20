import { z } from 'zod';
import { manualHealthWritePaths } from '../../health/data/manual-write-paths.ts';

/** One weigh-in waiting for an answer, or already declined (`GET /api/scale-ble/pending`). */
const waitingSchema = z.object({
  id: z.number(),
  measuredAt: z.string(),
  weightKg: z.number().nullable(),
});
export type WaitingWeighIn = z.infer<typeof waitingSchema>;

export const scaleWaitingSpec = {
  path: '/api/scale-ble/pending',
  schema: z.object({
    pending: z.array(waitingSchema),
    // An older deploy of the route omits it; absent reads as none.
    dismissed: z.array(waitingSchema).default([]),
  }),
  ttl: 30_000,
};

/** Today's confirmed weigh-ins, oldest first (`GET /api/scale-ble/today`). */
export const scaleTodaySpec = {
  path: '/api/scale-ble/today',
  schema: z.object({
    readings: z.array(
      z.object({
        id: z.number(),
        measuredAt: z.string(),
        isTrend: z.boolean(),
        weightKg: z.number().optional(),
        bodyFatPct: z.number().optional(),
      }),
    ),
  }),
  ttl: 30_000,
};

/**
 * What a filed weigh-in changes: everything a manual weight entry expires (`manualHealthWritePaths`,
 * the list HealthStore's writes use, so the two cannot drift), plus the groups the current app
 * clears after a weight entry that the local store does not cover itself
 * (`invalidateBodyMetricWrite` in `lib/cache-groups.ts`), plus the scale's own lists. A weigh-in
 * arrives from the server rather than through the local store, so `/api/body-metadata` is what
 * makes the store re-read it.
 */
export const scaleWritePaths = [
  ...new Set([
    ...manualHealthWritePaths,
    '/api/scale-ble',
    '/api/body-metadata',
    '/api/hr-profile',
    '/api/achievements',
  ]),
];
