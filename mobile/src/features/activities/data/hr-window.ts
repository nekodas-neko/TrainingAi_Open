import { z } from 'zod';
import type { HrSample } from './walk-pace.ts';

/**
 * The heart rate the server holds for a recording's window, the strap's where it was worn, else the
 * ring's: `/api/oura/hr-window`, the read a free activity saves its avg and max HR from. The guided
 * walk and the fitness tests read the same window for their blocks and test fields (#3641).
 */
export const hrWindowSchema = z.object({
  avgHr: z.number().nullish(),
  maxHr: z.number().nullish(),
  readings: z.array(z.object({ timestamp: z.string(), bpm: z.number() })).nullish(),
});
export type HrWindow = z.infer<typeof hrWindowSchema>;

export function hrWindowSpec(startMs: number | null | undefined, endMs: number | null | undefined) {
  return {
    path: '/api/oura/hr-window',
    query: {
      start: new Date(startMs ?? 0).toISOString(),
      end: new Date(endMs ?? 0).toISOString(),
    },
    ttl: 300_000,
    schema: hrWindowSchema,
  };
}

/** The window's readings as `{ at, bpm }`, oldest first; a reading with no usable time is dropped. */
export function hrSamples(window: HrWindow | null | undefined): HrSample[] {
  return (window?.readings ?? [])
    .map((reading) => ({ at: Date.parse(reading.timestamp), bpm: reading.bpm }))
    .filter((sample) => Number.isFinite(sample.at) && Number.isFinite(sample.bpm))
    .sort((a, b) => a.at - b.at);
}

/** The recording's avg and max HR as the save schema takes them: whole beats, absent when unknown. */
export function hrFields(window: HrWindow | null | undefined) {
  return {
    ...(window?.avgHr != null ? { avgHr: Math.round(window.avgHr) } : {}),
    ...(window?.maxHr != null ? { maxHr: Math.round(window.maxHr) } : {}),
  };
}
