import Svg, { Rect } from 'react-native-svg';
import { formatTimeOfDay } from '@trainingai/shared/date-utils';
import { formatHoursMinutes } from '@trainingai/shared/format/units';
import {
  hypnogramSegments,
  STAGE_LEVEL,
  type SleepStage,
} from '@trainingai/shared/health/hypnogram';
import {
  AppText,
  Badge,
  Card,
  Grid,
  MetricTile,
  KeyValueGrid,
  Stack,
} from '../../../shared/ui';
import { useTheme } from '../../../shared/theme/ThemeProvider';
import { useHealthData } from '../data/HealthDataProvider';
import { metricValue, type SleepRow } from '../data/models';

export function SleepNight({
  night,
  compact = false,
  stagesOnly = false,
}: {
  night: SleepRow;
  compact?: boolean;
  stagesOnly?: boolean;
}) {
  const { timezone } = useHealthData();
  const { theme } = useTheme();
  const segments = night.sleepPhase5Min ? hypnogramSegments(night.sleepPhase5Min) : [];
  const phaseStart = night.phaseWindowStart ?? night.sleepStart;
  const phaseEnd = night.phaseWindowEnd ?? night.sleepEnd;
  const duration = Math.max(
    1,
    phaseStart && phaseEnd
      ? (Date.parse(phaseEnd) - Date.parse(phaseStart)) / 60_000
      : (night.sleepPhase5Min?.length ?? 0) * 5,
  );
  const chart = (
    <Stack>
      {!!segments.length && (
        <>
          <Svg
            viewBox="0 0 320 120"
            width="100%"
            height={theme.sizes.chartHeight}
            accessibilityLabel="Recorded sleep stages"
          >
            {segments.map((segment, index) => (
              <Rect
                key={index}
                x={(segment.startMin / duration) * 320}
                y={STAGE_LEVEL[segment.stage] * 30 + 4}
                width={(segment.durationMin / duration) * 320}
                height={20}
                fill={theme.sleepStages[segment.stage]}
              />
            ))}
          </Svg>
          <Stack direction="row" wrap>
            {(['awake', 'rem', 'light', 'deep'] as SleepStage[]).map((stage) => (
              <AppText key={stage} variant="micro" style={{ color: theme.sleepStages[stage] }}>
                {stage.toUpperCase()}
              </AppText>
            ))}
          </Stack>
        </>
      )}
    </Stack>
  );
  if (stagesOnly) {
    return (
      <Card>
        <AppText variant="eyebrow" tone="muted">
          Sleep Stages
        </AppText>
        {segments.length ? (
          chart
        ) : (
          <AppText variant="caption" tone="muted">
            No sleep-stage data for this night yet — stages come from recorded device data.
          </AppText>
        )}
      </Card>
    );
  }
  return (
    <Card tone={compact ? 'neutral' : 'sleep'}>
      <Stack direction="row" wrap>
        <AppText variant="eyebrow" tone="muted">
          {compact ? 'Sleep' : night.date}
        </AppText>
        {night.manualEntry && <Badge label="Logged by hand" tone="sleep" />}
        {night.provisional && <Badge label="Still updating" tone="sleep" />}
      </Stack>
      {night.sourceLabel && (
        <AppText variant="caption" tone="muted">
          {night.sourceLabel}
          {night.sources?.length
            ? ` · ${night.sources.map((source) => source.name).join(', ')}`
            : ''}
        </AppText>
      )}
      <AppText variant="title">
        {night.durationHours === null ? '—' : formatHoursMinutes(night.durationHours * 60)}
      </AppText>
      {night.sleepStart && night.sleepEnd && (
        <AppText variant="caption" tone="muted">
          {formatTimeOfDay(night.sleepStart, timezone)} →{' '}
          {formatTimeOfDay(night.sleepEnd, timezone)}
        </AppText>
      )}
      {chart}
      {compact ? (
        <KeyValueGrid
          rows={(
            [
              ['deepSleepHours', 'Deep', 'h'],
              ['remSleepHours', 'REM', 'h'],
              ['lightSleepHours', 'Light', 'h'],
              ['awakHours', 'Awake', 'h'],
              ['efficiency', 'Efficiency', '%'],
              ['averageHrvMs', 'HRV (overnight)', 'ms'],
              ['avgHeartRate', 'Average HR', 'bpm'],
              ['lowestHeartRate', 'Lowest HR', 'bpm'],
              ['respiratoryRate', 'Breathing rate', 'br/min'],
            ] as const
          )
            .filter(([field]) => night[field] != null)
            .map(([field, label, unit]) => ({
              label,
              value: metricValue(night[field], unit, 1),
            }))}
        />
      ) : (
        <Grid columns={2}>
          {(
            [
              ['deepSleepHours', 'Deep', 'h'],
              ['remSleepHours', 'REM', 'h'],
              ['lightSleepHours', 'Light', 'h'],
              ['awakHours', 'Awake', 'h'],
              ['efficiency', 'Efficiency', '%'],
              ['averageHrvMs', 'HRV (overnight)', 'ms'],
              ['avgHeartRate', 'Average HR', 'bpm'],
              ['lowestHeartRate', 'Lowest HR', 'bpm'],
              ['respiratoryRate', 'Breathing rate', 'br/min'],
            ] as const
          )
            .filter(([field]) => night[field] !== null)
            .map(([field, label, unit]) => (
              <MetricTile
                key={field}
                label={label}
                value={metricValue(night[field], unit, 1)}
                tone="sleep"
              />
            ))}
        </Grid>
      )}
      {night.onsetLatencySec != null && (
        <AppText variant="caption" tone="muted">
          Time to fall asleep · {metricValue(night.onsetLatencySec / 60, 'min')}
        </AppText>
      )}
      {night.manualEntry && (
        <AppText variant="caption" tone="muted">
          Sleep stages, efficiency and heart metrics weren’t measured for this entry.
        </AppText>
      )}
    </Card>
  );
}
