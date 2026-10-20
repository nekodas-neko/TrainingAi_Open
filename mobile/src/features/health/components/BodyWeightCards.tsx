import { formatDateDisplay } from '@trainingai/shared/date-utils';
import { correctedSpan } from '@trainingai/shared/health/body-fat-display';
import {
  WEIGHT_TREND_WINDOW_DAYS,
  goalProgressPct,
  goalRemaining,
} from '@trainingai/shared/health/long-term-goal-progress';
import { AppText, Badge, Disclosure, ProgressBar, Stack } from '../../../shared/ui';
import { useTheme } from '../../../shared/theme/ThemeProvider';
import { bodyCardColors } from '../../../shared/theme/tokens';
import { displayFat, metricValue, type BodyRow } from '../data/models';
import { readingCount, signedRate, weightPaceLine } from '../data/body-view';
import { HealthMetricCard } from './HealthMetricCard';
import { useCueColor } from './RangeBar';

type Calibration = { offsetPct: number | null; pairCount: number | null } | null | undefined;

// The weight and body-fat cards plot the last seven days of readings. They are oldest first, and
// the axis names the first and last day (the cards are narrow, so a label per point would collide).
function trendPoints(rows: readonly BodyRow[], value: (row: BodyRow) => number | null) {
  return [...rows].reverse().map((row) => ({
    label: row.date,
    value: value(row),
    x: Date.parse(row.date),
  }));
}
function endLabels(points: readonly { label: string; value: number | null }[]) {
  const dates = points.filter((p) => p.value !== null).map((p) => p.label);
  return dates.length > 1
    ? [formatDateDisplay(dates[0], 'short'), formatDateDisplay(dates[dates.length - 1], 'short')]
    : undefined;
}

export function BodyWeightCard({
  rows,
  today,
  weight,
  weightDate,
  targetWeightKg,
  weightRateKgPerWeek,
  onLog,
  onOpen,
}: {
  rows: readonly BodyRow[];
  today: string;
  weight: number | null;
  weightDate: string | undefined;
  targetWeightKg: number | null;
  /** The progress summary's weekly rate: the figure the current app grades the pace with. */
  weightRateKgPerWeek: number | null;
  onLog: () => void;
  onOpen: () => void;
}) {
  const cueColor = useCueColor();
  const points = trendPoints(rows, (row) => row.weightKg);
  const gap =
    weight !== null && targetWeightKg !== null ? goalRemaining(weight, targetWeightKg) : null;
  const pace = weightPaceLine(weight, targetWeightKg, weightRateKgPerWeek);
  return (
    <HealthMetricCard
      title="Body Weight"
      value={weight}
      unit="kg"
      decimals={1}
      accent={bodyCardColors.weight}
      caption={weightDate && weightDate !== today ? `Last logged ${weightDate}` : 'Last 7 days'}
      onLog={onLog}
      onOpen={onOpen}
      points={points}
      chart={{ readable: true, gaps: 'connect', axisLabels: endLabels(points) }}
    >
      {gap && (
        <AppText variant="label" style={{ color: cueColor(gap.reached ? 'good' : 'watch') }}>
          {gap.reached ? '✓ Goal reached' : `↓ ${gap.diff} kg to go`}
        </AppText>
      )}
      {pace && (
        <AppText variant="caption" style={{ color: cueColor(pace.cue) }}>
          {pace.text}
        </AppText>
      )}
    </HealthMetricCard>
  );
}

export function WeightTrendCard({
  rows,
  slope,
  weight,
  fat,
  baselineWeightKg,
  baselineBodyFatPct,
  targetWeightKg,
  targetBfPct,
}: {
  rows: readonly BodyRow[];
  slope: number | null;
  weight: number | null;
  fat: number | null;
  baselineWeightKg: number | null;
  baselineBodyFatPct: number | null;
  targetWeightKg: number | null;
  targetBfPct: number | null;
}) {
  const { theme } = useTheme();
  const points = trendPoints(rows, (row) => row.weightKg);
  return (
    <HealthMetricCard
      title="Weight Trend"
      valueText={slope === null ? undefined : signedRate(slope)}
      value={slope === null ? null : undefined}
      unit="kg/wk"
      tone="recovery"
      caption={slope === null ? 'Need more data' : `Last ${WEIGHT_TREND_WINDOW_DAYS} days`}
      points={points.filter((p) => p.value !== null).length >= 2 ? points : undefined}
      chart={{ readable: true, gaps: 'connect', axisLabels: endLabels(points) }}
    >
      <Disclosure title="About this trend">
        <AppText variant="caption" tone="muted">
          Linear regression slope across your weight readings from the last{' '}
          {WEIGHT_TREND_WINDOW_DAYS} days. Positive = gaining, negative = losing. Needs at least 3
          readings to calculate.
        </AppText>
      </Disclosure>
      {weight !== null && baselineWeightKg !== null && targetWeightKg !== null && (
        <Stack gap="xs">
          <Stack direction="row" justify="space-between">
            <AppText variant="caption">Weight</AppText>
            <AppText variant="label">
              {weight} → {targetWeightKg} kg
            </AppText>
          </Stack>
          <ProgressBar value={goalProgressPct(baselineWeightKg, weight, targetWeightKg) / 100} />
        </Stack>
      )}
      {fat !== null && baselineBodyFatPct !== null && targetBfPct !== null && (
        <Stack gap="xs">
          <Stack direction="row" justify="space-between">
            <AppText variant="caption">Body Fat</AppText>
            <AppText variant="label">
              {fat}% → {targetBfPct}%
            </AppText>
          </Stack>
          <ProgressBar
            value={goalProgressPct(baselineBodyFatPct, fat, targetBfPct) / 100}
            color={theme.tones.activity.foreground}
          />
        </Stack>
      )}
    </HealthMetricCard>
  );
}

export function BodyFatCard({
  rows,
  targetBfPct,
  calibration,
  onLog,
  onOpen,
}: {
  rows: readonly BodyRow[];
  targetBfPct: number | null;
  calibration: Calibration;
  onLog: () => void;
  onOpen: () => void;
}) {
  const cueColor = useCueColor();
  const points = trendPoints(rows, displayFat);
  const readings = points.filter((p): p is typeof p & { value: number } => p.value !== null);
  const latest = readings.at(-1)?.value ?? null;
  if (latest === null) return null;
  const delta = readings.length >= 2 ? parseFloat((latest - readings[0].value).toFixed(1)) : null;
  const span = correctedSpan(rows);
  const gap = targetBfPct !== null ? goalRemaining(latest, targetBfPct) : null;
  return (
    <HealthMetricCard
      title="Body Fat"
      value={latest}
      unit="%"
      decimals={1}
      accent={bodyCardColors.fat}
      onOpen={onOpen}
      onLog={onLog}
      points={points}
      chart={{ readable: true, fill: true, gaps: 'connect', axisLabels: endLabels(points) }}
    >
      {delta !== null && (
        <Badge tone="nutrition" label={`${delta >= 0 ? '+' : ''}${delta.toFixed(1)}%`} />
      )}
      <AppText variant="caption" tone="muted">
        {readingCount(readings.length)}
      </AppText>
      {calibration?.offsetPct != null && (
        <AppText variant="caption" tone="muted">
          DEXA-corrected {calibration.offsetPct >= 0 ? '+' : ''}
          {calibration.offsetPct.toFixed(1)}% ·{' '}
          {calibration.pairCount === 1
            ? '1 scan compared'
            : `${calibration.pairCount ?? '—'} scans compared`}
        </AppText>
      )}
      {span.corrected > 0 && span.corrected < span.total && (
        <AppText variant="caption" tone="muted">
          {span.corrected} of {span.total} corrected — earlier readings are on another instrument
        </AppText>
      )}
      {gap && (
        <AppText variant="label" style={{ color: cueColor(gap.reached ? 'good' : 'watch') }}>
          {gap.reached ? '✓ Goal reached' : `↓ ${metricValue(gap.diff, '', 1)}% to go`}
        </AppText>
      )}
    </HealthMetricCard>
  );
}
