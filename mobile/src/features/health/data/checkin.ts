import { z } from 'zod';
import {
  DayCheckinScalesSchema,
  DayCheckinExtrasSchema,
} from '@trainingai/shared/validation/day-checkin';
export const morningSchema = DayCheckinScalesSchema.merge(DayCheckinExtrasSchema)
  .extend({ phase: z.literal('morning') })
  .strict();
export const checkinSchema = DayCheckinScalesSchema.merge(
  DayCheckinExtrasSchema.omit({ vsQuestion: true }),
)
  .extend({ vsQuestion: z.union([z.literal(1), z.literal(2)]).nullish() })
  .passthrough();
export const checkinSpec = (date: string) => ({
  path: '/api/day-checkin',
  query: { date, phase: 'morning' },
  ttl: 300_000,
  schema: checkinSchema.nullable(),
});
const n = z.number().finite().nullable();
export const verdictSpec = (date: string) => ({
  path: '/api/sleep-verdict',
  query: { date },
  ttl: 300_000,
  schema: z.object({
    verdict: z
      .object({
        date: z.string(),
        verdict: z.enum(['poor', 'normal', 'good']),
        triggered: z.array(z.enum(['duration', 'onset', 'efficiency'])),
        components: z.object({ durationHours: n, onsetMinutes: n, efficiency: n }),
        bands: z
          .object({
            durationLow: n,
            durationHigh: n,
            onsetLow: n,
            onsetHigh: n,
            efficiencyLow: n,
            efficiencyHigh: n,
          })
          .passthrough(),
        baselineNights: z.number(),
        modelVersion: z.number(),
        responseState: z.enum(['none', 'acknowledged', 'corrected']),
      })
      .nullable(),
  }),
});
export const readinessVerdictSpec = (date: string) => ({
  path: '/api/readiness-verdict',
  query: { date },
  ttl: 300_000,
  schema: z.object({
    verdict: z
      .object({
        date: z.string(),
        verdict: z.enum(['poor', 'normal', 'good']),
        score: z.number().finite(),
        band: z.object({ median: z.number(), low: z.number(), high: z.number() }),
        baselineDays: z.number(),
        modelVersion: z.number(),
        responseState: z.enum(['none', 'rated', 'dismissed']),
      })
      .passthrough()
      .nullable(),
  }).passthrough(),
});

/**
 * The comparison answer a morning-sheet save keeps. The sheet no longer shows the "vs normal" row
 * (#3334), but Home's readiness card (#2106) stores its Better / Same / Worse answer there, and a
 * check-in save writes the whole row, so the sheet carries the saved answer through rather than
 * writing null over it.
 */
export function carriedVsNormal(
  row: { vsNormal?: unknown; vsQuestion?: unknown; vsNormalTouched?: unknown } | null | undefined,
) {
  return {
    vsNormal: (['better', 'same', 'worse'] as const).find((feel) => feel === row?.vsNormal) ?? null,
    // Absent, not null: the schema takes 1 or 2 and nothing else.
    ...(row?.vsQuestion === 1
      ? { vsQuestion: 1 as const }
      : row?.vsQuestion === 2
        ? { vsQuestion: 2 as const }
        : {}),
    vsNormalTouched: row?.vsNormalTouched === true,
  };
}
