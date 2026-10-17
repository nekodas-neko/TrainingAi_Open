import { plural } from '@trainingai/shared/format/plural';
import {
  metricPattern,
  type DoseLevelRecovery,
  type MetricRecoveryResponse,
} from './weight-response';
export type HeartCardState = 'not_enough' | 'no_clear_pattern' | 'clear';
export interface HeartChartPoint {
  offset: number;
  median: number;
  p25: number;
  p75: number;
  cycles: number;
}
export interface HeartChart {
  metric: 'rhr' | 'hrv';
  title: string;
  unit: string;
  normal: {
    low: number;
    high: number;
    median: number;
  };
  points: HeartChartPoint[];
  days: number[];
}
export interface HeartCardView {
  state: HeartCardState;
  levelLabel: string;
  subtitle: string;
  chip: string;
  sentence: string | null;
  charts: HeartChart[];
}
export function levelLabel(
  level: Pick<DoseLevelRecovery, 'amount' | 'unit' | 'doseText'>,
): string {
  if (level.amount != null) return `${level.amount}${level.unit ? ` ${level.unit}` : ''}`;
  return level.doseText?.trim() || 'Amount not stated';
}
const dayWord = (offset: number) => (offset === 0 ? 'the dose day' : `day ${offset}`);
function rhrClause(r: MetricRecoveryResponse): string | null {
  const p = metricPattern(r);
  if (!p.peak || r.state !== 'ok') return null;
  const verb = p.peak.direction === 'up' ? 'climbs to' : 'drops to';
  let s = `Your resting HR ${verb} about ${Math.round(p.peak.value)} by ${dayWord(p.peak.offset)} (your normal is ${Math.round(r.baseline.median)})`;
  if (p.last && p.last.offset > p.peak.offset && p.last.outside) {
    s += ` and is still about ${Math.round(p.last.value)} on day ${p.last.offset}`;
  }
  return `${s}.`;
}
function hrvClause(r: MetricRecoveryResponse): string | null {
  const p = metricPattern(r);
  if (!p.peak || r.state !== 'ok') return null;
  const verb = p.peak.direction === 'down' ? 'drops to' : 'rises to';
  return `HRV ${verb} about ${Math.round(p.peak.value)} ms on ${dayWord(p.peak.offset)} (normal ${Math.round(r.baseline.median)}).`;
}
function chartFor(metric: 'rhr' | 'hrv', r: MetricRecoveryResponse): HeartChart | null {
  if (r.state !== 'ok') return null;
  const points: HeartChartPoint[] = r.offsets.flatMap((o) =>
    o.median === null || o.p25 === null || o.p75 === null
      ? []
      : [
          {
            offset: o.offset,
            median: r.baseline.median + o.median,
            p25: r.baseline.median + o.p25,
            p75: r.baseline.median + o.p75,
            cycles: o.cycles,
          },
        ],
  );
  if (points.length === 0) return null;
  const half = r.baseline.iqr / 2;
  return {
    metric,
    title: metric === 'rhr' ? 'Resting heart rate' : 'HRV',
    unit: metric === 'rhr' ? 'bpm' : 'ms',
    normal: {
      low: r.baseline.median - half,
      high: r.baseline.median + half,
      median: r.baseline.median,
    },
    points,
    days: Array.from({ length: points[points.length - 1].offset + 1 }, (_, i) => i),
  };
}
export function heartCardView(level: DoseLevelRecovery): HeartCardView {
  const label = levelLabel(level);
  const subtitle = `${label} · ${plural(level.doses, 'dose', 'doses')}`;
  const charts = [chartFor('rhr', level.rhr), chartFor('hrv', level.hrv)].filter(
    (c): c is HeartChart => c !== null,
  );
  if (charts.length === 0) {
    return {
      state: 'not_enough',
      levelLabel: label,
      subtitle,
      chip: 'Not enough yet',
      sentence: null,
      charts: [],
    };
  }
  const sentence = [rhrClause(level.rhr), hrvClause(level.hrv)]
    .filter((s): s is string => s !== null)
    .join(' ');
  if (sentence === '') {
    return {
      state: 'no_clear_pattern',
      levelLabel: label,
      subtitle,
      chip: 'No clear pattern yet',
      sentence: null,
      charts,
    };
  }
  return {
    state: 'clear',
    levelLabel: label,
    subtitle,
    chip: 'Clear pattern',
    sentence,
    charts,
  };
}
export { niceTicks } from '../../../shared/ui/chartScale';
