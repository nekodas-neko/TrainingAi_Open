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

/** `/api/oura-ble/battery-latest`: the newest ring battery reading from the last three days. */
export const ringBatterySpec = {
  path: '/api/oura-ble/battery-latest',
  ttl: 300_000,
  schema: z.object({
    latest: z
      .object({
        percent: z.number().finite(),
        charging: z.boolean().nullish(),
        ageMinutes: n,
      })
      .passthrough()
      .nullable(),
  }),
};
