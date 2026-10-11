// Whether a daytime sleep window is written as sleep at all (#2348, owner-approved 2026-10-07).
//
// The rollup opens a window wherever the ring emits its sleep-only signals (0x72/0x75) for an hour
// or more, and the ring emits them at a quiet desk as readily as in bed. Measured on the owner's
// rows since 2026-08-01: 47 nights (start 20:00–04:00) averaged 7.87 h, HR 63, HRV 54; 25 daytime
// windows averaged 1.53 h, HR 71, HRV 36, and the owner has taken no naps in that time. No fixed
// threshold separates a desk from a nap for everyone, so the bar is the person's OWN nights: a
// daytime window counts as sleep only when it looks like one of them.
//
// The rule, as approved:
//   1. the stager found sleep in it (> 0 h);
//   2. its average HR is at most the person's night p90 HR;
//   3. its HRV is at least the person's night p10 HRV, when the window has HRV.
// Until NAP_GATE_MIN_NIGHTS nights exist there is no personal p90/p10, so a new user gets the
// population default instead: HR at most resting HR + 10 bpm, and at least 20 staged minutes.
//
// Nights are never gated, and nothing is deleted from the raw archive: a dropped window simply is
// not written as a `sleep_sessions` row, and the rollup re-derives it from raw on any pass.

import { formatInTimeZone } from 'date-fns-tz'
import { quantile, median } from '@trainingai/shared/stats'

/** Local hour (inclusive) from which a window's START makes it a daytime window. */
export const DAYTIME_START_HOUR = 4
/** Local hour (exclusive) at which daytime ends; a window starting at or after it is a night. */
export const DAYTIME_END_HOUR = 20
/** Nights needed before the person's own p90 HR / p10 HRV replace the population default. */
export const NAP_GATE_MIN_NIGHTS = 14
/** How far back the person's nights are read for the reference, in days. */
export const NAP_GATE_REFERENCE_DAYS = 90
/** Population default: a daytime window's HR may sit this far above resting HR. */
export const POPULATION_NAP_HR_MARGIN_BPM = 10
/** Population default: the least staged sleep that can be a nap. */
export const POPULATION_NAP_MIN_HOURS = 20 / 60

/** True when a window starting at `start` is a daytime window (local 04:00–20:00). */
export function isDaytimeStart(start: Date, tz: string): boolean {
  const h = Number(formatInTimeZone(start, tz, 'H'))
  return h >= DAYTIME_START_HOUR && h < DAYTIME_END_HOUR
}

/** The per-window figures the gate reads. A `sleep_sessions` row satisfies it. */
export interface NapGateWindow {
  sleepStart: Date
  durationHours?: number | null
  avgHeartRate?: number | null
  averageHrvMs?: number | null
  lowestHeartRate?: number | null
}

export type NapGateReference =
  | { kind: 'personal'; nights: number; hrMax: number; hrvMin: number | null }
  | { kind: 'population'; nights: number; restingHr: number | null }

/**
 * The person's reference, learned from their nights: every window that starts outside daytime,
 * recorded sleep, and has a heart rate. Pass the nights you have — persisted and this pass's alike;
 * the caller owns de-duplicating them.
 */
export function napGateReference(windows: NapGateWindow[], tz: string): NapGateReference {
  const nights = windows.filter(w =>
    !isDaytimeStart(w.sleepStart, tz) && (w.durationHours ?? 0) > 0 && w.avgHeartRate != null)
  const hrs = nights.map(n => n.avgHeartRate as number)
  if (nights.length < NAP_GATE_MIN_NIGHTS) {
    const lows = nights.map(n => n.lowestHeartRate).filter((v): v is number => v != null)
    return { kind: 'population', nights: nights.length, restingHr: median(lows) }
  }
  const hrvs = nights.map(n => n.averageHrvMs).filter((v): v is number => v != null)
  return {
    kind: 'personal',
    nights: nights.length,
    hrMax: quantile(hrs, 0.9) as number,
    hrvMin: hrvs.length >= NAP_GATE_MIN_NIGHTS ? quantile(hrvs, 0.1) : null,
  }
}

export type NapGateVerdict =
  | { keep: true; reason: 'night' | 'nap' }
  | { keep: false; reason: 'no_sleep' | 'hr_above_nights' | 'hrv_below_nights' | 'too_short' | 'no_heart_rate' }

/** Whether a window is written as sleep. Nights always are; a daytime window has to earn it. */
export function napGateVerdict(w: NapGateWindow, ref: NapGateReference, tz: string): NapGateVerdict {
  if (!isDaytimeStart(w.sleepStart, tz)) return { keep: true, reason: 'night' }
  const hours = w.durationHours ?? 0
  if (hours <= 0) return { keep: false, reason: 'no_sleep' }
  if (ref.kind === 'personal') {
    if (w.avgHeartRate == null) return { keep: false, reason: 'no_heart_rate' }
    if (w.avgHeartRate > ref.hrMax) return { keep: false, reason: 'hr_above_nights' }
    if (ref.hrvMin != null && w.averageHrvMs != null && w.averageHrvMs < ref.hrvMin) {
      return { keep: false, reason: 'hrv_below_nights' }
    }
    return { keep: true, reason: 'nap' }
  }
  if (hours < POPULATION_NAP_MIN_HOURS) return { keep: false, reason: 'too_short' }
  if (ref.restingHr != null && w.avgHeartRate != null
    && w.avgHeartRate > ref.restingHr + POPULATION_NAP_HR_MARGIN_BPM) {
    return { keep: false, reason: 'hr_above_nights' }
  }
  return { keep: true, reason: 'nap' }
}
