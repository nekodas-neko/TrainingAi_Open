import { z } from 'zod';

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
 * What a filed weigh-in changes: the groups the current app clears after a weight entry
 * (`invalidateBodyMetricWrite` and `invalidateReadinessInputs` in `lib/cache-groups.ts`), plus the
 * scale's own lists. A weigh-in does not move the steps ladder, so the collection is not here.
 */
export const scaleWritePaths = [
  '/api/scale-ble',
  '/api/body-metadata',
  '/api/nutrition/energy-balance',
  '/api/progress-summary',
  '/api/day-log',
  '/api/health-trends',
  '/api/health/trends',
  '/api/hr-profile',
  '/api/readiness-score',
  '/api/body-battery',
  '/api/achievements',
];
