import { shiftDateStr } from '@trainingai/shared/date-utils'
import type { DoseEvent } from '@trainingai/shared/health/dose-context'

/**
 * TN-46 — shaping the dose/vitals overlay, kept pure so the lag rule can be tested.
 *
 * The one thing this must not do is invite a same-day reading. The measured effect peaks 2–4 days
 * after a dose, so a night is marked as "after a dose" only from the day AFTER one, out to
 * `lookbackDays`. A night that merely shares its date with a dose is not in that window.
 */

export type DoseMetric = 'rhr' | 'hrv'

export interface DoseVitalsNightInput {
  date: string
  restingHr: number | null
  hrvMs: number | null
  restingHrBaseline: number | null
  hrvBaseline: number | null
}

export interface DoseVitalsPoint {
  date: string
  value: number | null
  baseline: number | null
  /** A dose was administered on this date. Deliberately NOT the same as being in the window. */
  dosedOn: boolean
  /** This night falls 1..lookbackDays after a dose — the span where an effect was measured. */
  inEffectWindow: boolean
}

export const METRIC_LABEL: Record<DoseMetric, string> = { rhr: 'Resting HR', hrv: 'HRV' }
export const METRIC_UNIT: Record<DoseMetric, string> = { rhr: 'bpm', hrv: 'ms' }

export function buildDoseVitalsSeries(
  nights: DoseVitalsNightInput[],
  doses: DoseEvent[],
  metric: DoseMetric,
  lookbackDays: number,
): DoseVitalsPoint[] {
  const dosedOn = new Set(doses.map(d => d.date))
  // Every night a dose can still be acting on, built by walking forward from each dose rather than
  // back from each night: `shiftDateStr` owns the calendar arithmetic, and a month end walked by
  // hand is how `2026-06-31` once reached a date constructor.
  const inWindow = new Set<string>()
  for (const d of doses) {
    for (let i = 1; i <= lookbackDays; i++) inWindow.add(shiftDateStr(d.date, i))
  }

  return nights.map(n => ({
    date: n.date,
    value: metric === 'rhr' ? n.restingHr : n.hrvMs,
    baseline: metric === 'rhr' ? n.restingHrBaseline : n.hrvBaseline,
    dosedOn: dosedOn.has(n.date),
    inEffectWindow: inWindow.has(n.date),
  }))
}

/** A chart with no readings is an empty frame with axes — say so instead of drawing it. */
export function hasAnyReading(points: DoseVitalsPoint[]): boolean {
  return points.some(p => p.value != null)
}

/**
 * The most recent doses, newest first.
 *
 * Sorted here rather than trusted: the route's ordering is its own business, and a list captioned
 * "most recent" that renders whatever order it was handed is wrong the day that changes.
 */
export function latestDoses(doses: DoseEvent[], limit = 3): DoseEvent[] {
  return [...doses].sort((a, b) => b.date.localeCompare(a.date)).slice(0, limit)
}

/** "Testosterone · 0.4 mL" — the log's own amount and unit, never the vial's. */
export function doseLabel(dose: DoseEvent): string {
  const amount = dose.unit ? `${dose.amount} ${dose.unit}` : String(dose.amount)
  return `${dose.supplementName} · ${amount}`
}
