import {
  BLOCK_TREND_COPY,
  BLOCK_TREND_NOT_ENOUGH_HISTORY,
  BLOCK_TREND_STEADY_BAND,
  blockTrendBasis,
} from '@trainingai/shared/ai-periodization/block-trend-copy';
import type { BlockTrendData } from './models.ts';

export type BlockTrendView =
  | { kind: 'hidden' }
  | { kind: 'not_enough_history'; message: string }
  | {
      kind: 'ok';
      band: 'detraining' | 'steady' | 'building';
      copy: string;
      basis: string | null;
      chart: BlockTrendChart | null;
    };

export type BlockTrendChart = {
  points: { label: string; value: number; x: number }[];
  domain: [number, number];
  zone: { from: number; to: number; fromLabel: string; toLabel: string };
  axisLabels: string[];
};

const DAY_MS = 86_400_000;
const dayNumber = (date: string) => Date.parse(`${date}T00:00:00Z`) / DAY_MS;

/** The y range: the whole steady band with a margin, widened to hold every point, on 0.1 steps. */
export function blockTrendDomain(values: readonly number[]): [number, number] {
  const lo = Math.min(BLOCK_TREND_STEADY_BAND.from - 0.2, ...values);
  const hi = Math.max(BLOCK_TREND_STEADY_BAND.to + 0.2, ...values);
  return [Math.floor(lo * 10 + 1e-9) / 10, Math.ceil(hi * 10 - 1e-9) / 10];
}

export function blockTrendChart(points: BlockTrendData['points']): BlockTrendChart | null {
  if (points.length < 2) return null;
  const last = dayNumber(points.at(-1)!.date);
  const weeksBack = points.map((p) => Math.round((last - dayNumber(p.date)) / 7));
  const { from, to } = BLOCK_TREND_STEADY_BAND;
  return {
    points: points.map((p, i) => ({ label: `${weeksBack[i]}w ago`, value: p.ratio, x: -weeksBack[i] })),
    domain: blockTrendDomain(points.map((p) => p.ratio)),
    zone: { from, to, fromLabel: from.toFixed(1), toLabel: to.toFixed(1) },
    // Only the ends are named: ten labels do not fit 384 px.
    axisLabels: points.map((_, i) => (i === 0 ? `${weeksBack[i]}w ago` : i === points.length - 1 ? 'Now' : '')),
  };
}

/** What the Training Load card shows for the 28:90 block trend (undefined = payload without the field). */
export function blockTrendView(trend: BlockTrendData | null | undefined): BlockTrendView {
  if (trend === null) return { kind: 'hidden' };
  if (trend === undefined || trend.status === 'not_enough_history' || trend.band === null) {
    return { kind: 'not_enough_history', message: BLOCK_TREND_NOT_ENOUGH_HISTORY };
  }
  return {
    kind: 'ok',
    band: trend.band,
    copy: BLOCK_TREND_COPY[trend.band],
    basis: blockTrendBasis(trend.spanDays),
    chart: blockTrendChart(trend.points),
  };
}
