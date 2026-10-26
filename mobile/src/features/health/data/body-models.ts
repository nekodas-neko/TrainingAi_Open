import { z } from 'zod';

// Read-only server resources the Body panel's Ring card needs. They are plain server reads the
// current app already makes; neither needs Bluetooth on the phone.
const n = z
  .number()
  .finite()
  .nullish()
  .transform((value) => value ?? null);

/** `/api/oura/stats`: whether the ring has produced data, and today's rollup (non-wear time). */
export const ouraStatsSpec = (date: string) => ({
  path: '/api/oura/stats',
  partition: date,
  ttl: 300_000,
  schema: z.object({
    connected: z.boolean(),
    daily: z.object({ nonWearTimeSec: n }).passthrough().nullable(),
  }),
});

/**
 * `/api/oura/ring-battery` (#3069): the newest ring battery reading, from Bluetooth polls and Oura
 * Cloud together, with the drain, charge and days-left figures the Oura Ring screen shows.
 */
export const ringBatterySpec = {
  path: '/api/oura/ring-battery',
  ttl: 300_000,
  schema: z.object({
    latest: z
      .object({
        percent: z.number().finite(),
        charging: z.boolean().nullish(),
        tsMs: z.number().finite(),
        ageMinutes: n,
      })
      .passthrough()
      .nullable(),
    drainPerDayPct: n,
    daysLeft: n,
    daysBetweenCharges: n,
    avgChargeSec: n,
    lastChargedMs: n,
    series: z.array(z.object({ day: z.string(), drainPct: z.number().finite() })).default([]),
  }),
};
