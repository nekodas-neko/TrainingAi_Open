import { formatDateDisplay } from '@trainingai/shared/date-utils';
export interface ResilienceCoverage {
  daysSeen: number;
  daysMeetingCoverageGate: number | null;
  coverageGateMinutes: number | null;
  minValidDays: number | null;
  modelWindowDays: number | null;
}
export function resilienceShortfallLine(c: ResilienceCoverage): string | null {
  if (!Number.isFinite(c.daysSeen) || c.daysSeen <= 0) return null;
  const days = (n: number) => `${n} day${n === 1 ? '' : 's'}`;
  if (c.daysMeetingCoverageGate == null) {
    return `Checked the last ${days(c.daysSeen)}.`;
  }
  const seen = `${c.daysMeetingCoverageGate} of the last ${days(c.daysSeen)} had enough daytime coverage`;
  return c.minValidDays != null && c.modelWindowDays != null
    ? `${seen}; the model needs ${c.minValidDays} of ${c.modelWindowDays}.`
    : `${seen}.`;
}
export function resilienceAsOfLine(asOf: string | null, today: string): string | null {
  if (asOf == null || asOf >= today) return null;
  return `From ${formatDateDisplay(asOf, 'short')}, not today.`;
}
