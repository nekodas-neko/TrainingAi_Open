import { shiftDateStr } from '@trainingai/shared/date-utils';
import type { DoseEvent } from '@trainingai/shared/health/dose-context';
export type DoseMetric = 'rhr' | 'hrv';
export interface DoseVitalsNightInput {
  date: string;
  restingHr: number | null;
  hrvMs: number | null;
  restingHrBaseline: number | null;
  hrvBaseline: number | null;
}
export interface DoseVitalsPoint {
  date: string;
  value: number | null;
  baseline: number | null;
  dosedOn: boolean;
  inEffectWindow: boolean;
}
export const METRIC_LABEL: Record<DoseMetric, string> = { rhr: 'Resting HR', hrv: 'HRV' };
export const METRIC_UNIT: Record<DoseMetric, string> = { rhr: 'bpm', hrv: 'ms' };
export function buildDoseVitalsSeries(
  nights: DoseVitalsNightInput[],
  doses: DoseEvent[],
  metric: DoseMetric,
  lookbackDays: number,
): DoseVitalsPoint[] {
  const dosedOn = new Set(doses.map((d) => d.date));
  const inWindow = new Set<string>();
  for (const d of doses) {
    for (let i = 1; i <= lookbackDays; i++) inWindow.add(shiftDateStr(d.date, i));
  }
  return nights.map((n) => ({
    date: n.date,
    value: metric === 'rhr' ? n.restingHr : n.hrvMs,
    baseline: metric === 'rhr' ? n.restingHrBaseline : n.hrvBaseline,
    dosedOn: dosedOn.has(n.date),
    inEffectWindow: inWindow.has(n.date),
  }));
}
export function hasAnyReading(points: DoseVitalsPoint[]): boolean {
  return points.some((p) => p.value != null);
}
export function latestDoses(doses: DoseEvent[], limit = 3): DoseEvent[] {
  return [...doses].sort((a, b) => b.date.localeCompare(a.date)).slice(0, limit);
}
export function doseLabel(dose: DoseEvent): string {
  const amount = dose.unit ? `${dose.amount} ${dose.unit}` : String(dose.amount);
  return `${dose.supplementName} · ${amount}`;
}
