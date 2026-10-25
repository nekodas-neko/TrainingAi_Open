import { View } from 'react-native';
import { formatDayShort } from '@trainingai/shared/date-utils';
import { acwrBandByKey } from '@trainingai/shared/ai-periodization/acwr';
import { rangeStats } from '@trainingai/shared/health/range-stats';
import { AppButton, AppText, Card, Disclosure, Grid, LineChart, Stack } from '../../../shared/ui';
import { useTheme } from '../../../shared/theme/ThemeProvider';
import { useWorkoutResource } from '../../workouts/data/WorkoutDataProvider';
import { ResourceStatus } from '../../workouts/components/ResourceStatus';
import { blockTrendView, type BlockTrendView } from '../data/block-trend-view';
import { loadSpec, metricValue, readinessSpec, type BodyRow } from '../data/models';
import { hrvBaselineDeviationPct } from '@trainingai/shared/health/hrv-baseline';
import { acwrZoneLabel, hrvBaselineBand, latestReading, type Cue } from '../data/body-view';
import { useHealthData } from '../data/HealthDataProvider';
import { HealthMetricCard } from './HealthMetricCard';
import { RangeBar, useCueColor } from './RangeBar';
import { TrainingStressLine } from './TrainingStressLine';
import type { MetricKind } from './MetricHistorySheet';

type Field = 'restingHeartRate' | 'hrvMs' | 'spo2Pct';

/**
 * Resting HR, HRV and SpO2 tiles, the "Vs your recent days" range bars under them and the link to
 * the heart-rate details, as the current app's card.
 */
export function HeartTiles({
  rows,
  onOpen,
  onDetails,
}: {
  rows: readonly BodyRow[];
  onOpen: (field: MetricKind) => void;
  onDetails: () => void;
}) {
  const { theme } = useTheme();
  const { today } = useHealthData();
  const defs = [
    {
      field: 'restingHeartRate',
      title: 'Resting HR',
      unit: 'bpm',
      note: undefined,
      accent: theme.anatomy.injured,
      optimal: 'low',
      format: (v: number) => `${Math.round(v)}`,
    },
    {
      field: 'hrvMs',
      title: 'HRV',
      unit: 'ms',
      note: 'rMSSD · overnight',
      accent: theme.anatomy.secondary,
      optimal: 'high',
      format: (v: number) => `${Math.round(v)}`,
    },
    {
      field: 'spo2Pct',
      title: 'SpO₂',
      unit: '%',
      note: 'O₂',
      accent: theme.tones.recovery.foreground,
      optimal: 'high',
      format: (v: number) => v.toFixed(1),
    },
  ] as const satisfies readonly {
    field: Field;
    title: string;
    unit: string;
    note: string | undefined;
    accent: string;
    optimal: 'low' | 'high';
    format: (v: number) => string;
  }[];
  const bars = defs.flatMap((def) => {
    const reading = latestReading(rows, def.field, today);
    const stats = rangeStats(rows.map((row) => row[def.field]));
    return reading && stats.max !== null ? [{ def, reading, stats }] : [];
  });
  return (
    <>
      <Grid columns={3}>
        {defs.map((def) => {
          const reading = latestReading(rows, def.field, today);
          return (
            <HealthMetricCard
              key={def.field}
              compact
              title={def.title}
              value={reading?.value ?? null}
              decimals={def.field === 'spo2Pct' ? 1 : 0}
              unit={def.unit}
              accent={def.accent}
              caption={
                [def.note, reading?.staleDate ? formatDayShort(reading.staleDate) : null]
                  .filter(Boolean)
                  .join(' · ') || undefined
              }
              onOpen={() => onOpen(def.field)}
            />
          );
        })}
      </Grid>
      {bars.length > 0 && (
        <Card>
          <AppText variant="eyebrow" tone="muted">
            Vs your recent days
          </AppText>
          {bars.map(({ def, reading, stats }) => (
            <RangeBar
              key={def.field}
              label={def.title}
              value={reading.value}
              min={stats.min}
              max={stats.max}
              avg={stats.avg}
              accent={def.accent}
              optimal={def.optimal}
              format={def.format}
            />
          ))}
        </Card>
      )}
      <AppButton title="Heart rate details →" variant="ghost" onPress={onDetails} />
    </>
  );
}

/** HRV, 7 days against the 28-day baseline: green and HIGH above baseline, amber then red below it. */
export function HrvBaselineCard() {
  const { today } = useHealthData();
  const { theme } = useTheme();
  const cueColor = useCueColor();
  const readiness = useWorkoutResource(readinessSpec(today));
  const baseline = readiness.data?.baselineHrv ?? null;
  const recent = readiness.data?.recentHrv ?? null;
  if (baseline === null || baseline <= 0 || recent === null) return null;
  const deviation = hrvBaselineDeviationPct(recent, baseline);
  const band = hrvBaselineBand(deviation);
  const color = cueColor(band.cue);
  return (
    <Card accent={color}>
      <AppText variant="eyebrow" tone="muted">
        HRV · 7d vs 28d baseline
      </AppText>
      <Stack direction="row" align="baseline" wrap gap="sm">
        <AppText variant="title" style={{ color, fontVariant: ['tabular-nums'] }}>
          {deviation > 0 ? '+' : ''}
          {deviation}%
        </AppText>
        <AppText variant="eyebrow" style={{ color }}>
          {band.label.toUpperCase()}
        </AppText>
        <AppText variant="caption" tone="muted">
          {metricValue(recent, 'ms')} recent vs {metricValue(baseline, 'ms')} baseline
        </AppText>
      </Stack>
      <AppText variant="caption" tone="muted">
        7-day average of overnight HRV vs your 28-day baseline (low-wear days excluded)
      </AppText>
      <View
        style={{
          borderRadius: theme.radii.control,
          backgroundColor: theme.colors.raised,
          padding: theme.spacing.md,
        }}
      >
        <AppText variant="caption" tone="muted">
          HRV above your baseline generally signals good recovery; a sustained drop can be an early
          sign of fatigue, illness, or under-recovery.
        </AppText>
      </View>
    </Card>
  );
}

const meterCue = (monotony: number): Cue =>
  monotony > 2 ? 'bad' : monotony > 1.5 ? 'watch' : 'good';

function MonotonyMeter({ monotony, strain }: { monotony: number; strain: number | null }) {
  const { theme } = useTheme();
  const cueColor = useCueColor();
  const pct = Math.max(2, Math.min(98, (monotony / 2.5) * 100));
  const marker = theme.spacing.lg;
  return (
    <Stack>
      <Stack direction="row" justify="space-between">
        <AppText variant="caption" tone="muted">
          Monotony
        </AppText>
        <AppText variant="label" style={{ color: cueColor(meterCue(monotony)) }}>
          {monotony.toFixed(2)}
        </AppText>
      </Stack>
      <View style={{ height: marker, justifyContent: 'center' }}>
        <View
          style={{
            height: theme.spacing.sm,
            flexDirection: 'row',
            borderRadius: theme.radii.pill,
            overflow: 'hidden',
          }}
        >
          {(
            [
              ['good', 60],
              ['watch', 20],
              ['bad', 20],
            ] as const
          ).map(([cue, width]) => (
            <View
              key={cue}
              style={{ width: `${width}%`, backgroundColor: cueColor(cue), opacity: 0.35 }}
            />
          ))}
        </View>
        <View
          style={{
            position: 'absolute',
            left: `${pct}%`,
            marginLeft: -theme.spacing.xxs,
            width: theme.spacing.xs,
            height: marker,
            borderRadius: theme.radii.pill,
            backgroundColor: theme.colors.text,
          }}
        />
      </View>
      <Stack direction="row" justify="space-between">
        <AppText variant="micro" tone="muted">
          Varied
        </AppText>
        <AppText variant="micro" tone="muted">
          Monotonous
        </AppText>
      </Stack>
      {strain !== null && (
        <Stack direction="row" justify="space-between">
          <AppText variant="caption" tone="muted">
            Weekly strain
          </AppText>
          <AppText variant="label">{Math.round(strain).toLocaleString()}</AppText>
        </Stack>
      )}
    </Stack>
  );
}

/**
 * The 28:90 block trend under the ACWR: a weekly line against the shaded steady band, one insight
 * line and, while the data covers under 3 months, how much it rests on (#2740).
 */
function BlockTrend({ view, loaded }: { view: BlockTrendView; loaded: boolean }) {
  if (!loaded || view.kind === 'hidden') return null;
  if (view.kind === 'not_enough_history') {
    return (
      <AppText variant="caption" tone="muted">
        {view.message}
      </AppText>
    );
  }
  return (
    <Stack gap="sm">
      {view.chart && (
        <LineChart
          label="Block trend, last 4 weeks against your 3-month norm"
          points={view.chart.points}
          axisLabels={view.chart.axisLabels}
          domain={view.chart.domain}
          zone={view.chart.zone}
          gaps="connect"
          dots="none"
          readable
        />
      )}
      <AppText variant="body">{view.copy}</AppText>
      {view.basis && (
        <AppText variant="caption" tone="muted">
          {view.basis}
        </AppText>
      )}
    </Stack>
  );
}

/**
 * Training Load (ACWR): the ratio in its zone colour with the zone wording, and behind a toggle the
 * monotony and strain, the stress line and the explainer. Acute and chronic load are not shown,
 * as in the current app.
 */
export function TrainingLoadCard() {
  const load = useWorkoutResource(loadSpec);
  const interpretation = load.data?.interpretation;
  const insufficient =
    !load.data || interpretation === 'insufficient_data' || load.data.acwr === null;
  const baselining = interpretation === 'baselining';
  const bandKey =
    interpretation === 'low' ||
    interpretation === 'optimal' ||
    interpretation === 'high' ||
    interpretation === 'very_high'
      ? interpretation
      : null;
  const zone = acwrZoneLabel(interpretation);
  return (
    <Card>
      <Stack direction="row" align="center" justify="space-between">
        <AppText variant="eyebrow" tone="muted">
          Training Load (ACWR)
        </AppText>
        <ResourceStatus inline label="Training Load" state={load} refresh={load.refresh} />
      </Stack>
      {baselining ? (
        <AppText variant="heading">Baselining new routine</AppText>
      ) : insufficient ? (
        <AppText variant="heading">
          {load.error && !load.data
            ? "Couldn't load your training load"
            : load.loading && !load.data
              ? 'Loading…'
              : 'Not enough data yet'}
        </AppText>
      ) : (
        <Stack direction="row" align="baseline" gap="md" wrap>
          <AppText
            variant="title"
            style={{
              fontVariant: ['tabular-nums'],
              color: bandKey ? acwrBandByKey(bandKey).color : undefined,
            }}
          >
            {load.data!.acwr!.toFixed(2)}
          </AppText>
          {zone && (
            <AppText variant="body" tone="muted">
              {zone}
            </AppText>
          )}
        </Stack>
      )}
      <BlockTrend view={blockTrendView(load.data?.blockTrend)} loaded={!!load.data} />
      <Disclosure title="Details">
        {baselining && (
          <AppText variant="caption" tone="muted">
            ACWR will be available once your program has 28 days of history
            {load.data?.baselineDaysRemaining != null
              ? ` (${load.data.baselineDaysRemaining} days remaining)`
              : ''}
          </AppText>
        )}
        <AppText variant="caption" tone="muted">
          Last 7 days vs 28-day weekly avg · green zone: 0.8–1.3
        </AppText>
        {load.data?.monotony != null && (
          <MonotonyMeter monotony={load.data.monotony} strain={load.data.strain} />
        )}
        <TrainingStressLine />
        <AppText variant="caption" tone="muted">
          ACWR = last 7 days vs your 28-day average. Under 0.8 detrains, 0.8–1.3 is the sweet spot,
          over 1.5 raises injury risk. Monotony flags training that’s too samey.
        </AppText>
      </Disclosure>
    </Card>
  );
}
