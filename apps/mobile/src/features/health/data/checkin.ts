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
