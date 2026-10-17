import { capitalize } from '@trainingai/shared/format/capitalize';
import type { SleepComponent, SleepVerdict } from '@trainingai/shared/health/sleep-verdict';
import { formatMinutesOfDay } from '@trainingai/shared/date-utils';
export interface StoredSleepVerdict {
  date: string;
  verdict: SleepVerdict;
  triggered: SleepComponent[];
  components: {
    durationHours: number | null;
    onsetMinutes: number | null;
    efficiency: number | null;
  };
  bands: {
    durationLow: number | null;
    durationHigh: number | null;
    onsetLow: number | null;
    onsetHigh: number | null;
    efficiencyLow: number | null;
    efficiencyHigh: number | null;
    durationMedian?: number | null;
    onsetMedian?: number | null;
    efficiencyMedian?: number | null;
  };
  baselineNights: number;
  modelVersion: number;
  responseState: 'none' | 'acknowledged' | 'corrected';
}
export function formatDuration(hours: number): string {
  const total = Math.round(hours * 60);
  return `${Math.floor(total / 60)}h${String(total % 60).padStart(2, '0')}`;
}
export function formatClock(minutesFromMidnight: number): string {
  return formatMinutesOfDay(minutesFromMidnight);
}
export function componentClause(
  v: StoredSleepVerdict,
  component: SleepComponent,
): string | null {
  const value = componentValue(v, component);
  const delta = componentDelta(v, component);
  return value && delta ? `${value}, ${delta}` : null;
}
export function componentValue(
  v: StoredSleepVerdict,
  component: SleepComponent,
): string | null {
  const { components: c, bands: b } = v;
  if (component === 'duration') {
    return c.durationHours == null || b.durationLow == null || b.durationHigh == null
      ? null
      : `slept ${formatDuration(c.durationHours)}`;
  }
  if (component === 'onset') {
    return c.onsetMinutes == null || b.onsetLow == null || b.onsetHigh == null
      ? null
      : `asleep at ${formatClock(c.onsetMinutes)}`;
  }
  return c.efficiency == null || b.efficiencyLow == null || b.efficiencyHigh == null
    ? null
    : `${Math.round(c.efficiency)}% of the night asleep`;
}
export function componentDelta(
  v: StoredSleepVerdict,
  component: SleepComponent,
): string | null {
  const { components: c, bands: b } = v;
  if (component === 'duration') {
    if (c.durationHours == null || b.durationLow == null || b.durationHigh == null) return null;
    const over = c.durationHours > b.durationHigh;
    const delta = over ? c.durationHours - b.durationHigh : b.durationLow - c.durationHours;
    return `${formatDuration(delta)} ${over ? 'over' : 'short of'} your usual`;
  }
  if (component === 'onset') {
    if (c.onsetMinutes == null || b.onsetLow == null || b.onsetHigh == null) return null;
    const late = c.onsetMinutes > b.onsetHigh;
    const delta = Math.round(late ? c.onsetMinutes - b.onsetHigh : b.onsetLow - c.onsetMinutes);
    return `${delta} min ${late ? 'later' : 'earlier'} than usual`;
  }
  if (c.efficiency == null || b.efficiencyLow == null || b.efficiencyHigh == null) return null;
  const over = c.efficiency > b.efficiencyHigh;
  const delta = Math.round(
    over ? c.efficiency - b.efficiencyHigh : b.efficiencyLow - c.efficiency,
  );
  return `${delta} points ${over ? 'above' : 'below'} your usual`;
}
export interface VerdictCopy {
  line: string;
  prominent: boolean;
}
export function verdictCopy(v: StoredSleepVerdict): VerdictCopy {
  if (v.verdict === 'normal') {
    return { line: 'Sleep looks normal — filled in for you.', prominent: false };
  }
  const parts = v.triggered
    .map((component) => ({
      component,
      value: componentValue(v, component),
      delta: componentDelta(v, component),
    }))
    .filter((p) => p.value != null && p.delta != null)
    .slice(0, 2);
  const clauses =
    parts.length === 1
      ? [`${parts[0].value}, ${parts[0].delta}`]
      : parts.map((p, i) =>
          i === 0 || p.component === 'efficiency'
            ? `${p.value}${i === 0 ? '' : `, ${p.delta}`}`
            : p.delta!,
        );
  const word = v.verdict === 'poor' ? 'poor' : 'good';
  const evidence = clauses.length > 0 ? `${capitalize(clauses.join(', '))}. ` : '';
  return { line: `${evidence}Marked this a ${word} night.`, prominent: true };
}
export function verdictToStoredFeel(verdict: SleepVerdict): number {
  return verdict === 'good' ? 2 : verdict === 'poor' ? 4 : 3;
}
