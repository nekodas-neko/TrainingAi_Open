import { useState } from 'react';
import {
  computeSleepStartConsistency,
  minutesFromNoon,
} from '@trainingai/shared/health/sleep-consistency';
import { formatMinutesOfDay } from '@trainingai/shared/date-utils';
import {
  AppText,
  Card,
  LineChart,
  SegmentedControl,
  StackedBarChart,
  Stack,
  StableContent,
} from '../../../shared/ui';
import { useTheme } from '../../../shared/theme/ThemeProvider';
import { useHealthData } from '../data/HealthDataProvider';
import { sleepTrendAt } from '../data/body-view';
export function SleepTrendsCard() {
  const health = useHealthData();
  const { theme } = useTheme();
  const [view, setView] = useState<'phases' | 'bedtime' | 'wake'>('phases');
  const nights = health.sleep.slice(0, 14).reverse();
  const starts = health.sleep
    .slice(0, 7)
    .flatMap((night) => (night.sleepStart ? [night.sleepStart] : []));
  const consistency = computeSleepStartConsistency(starts, health.timezone);
  const points = nights.map((night) => {
    const at = sleepTrendAt(night, view === 'bedtime' ? 'bedtime' : 'wake');
    const value = at ? minutesFromNoon(at, health.timezone) : null;
    return {
      label: night.date,
      value: value === null ? null : view === 'wake' ? (value + 720) % 1440 : value,
    };
  });
  const valid = points.flatMap((point) => (point.value === null ? [] : [point.value]));
  if (!nights.length) {
    return null;
  }
  return (
    <>
      {consistency.sdMinutes !== null && (
        <Card>
          <AppText variant="eyebrow" tone="muted">
            Sleep Consistency
          </AppText>
          <AppText variant="heading">
            Bedtime varies by ~{Math.round(consistency.sdMinutes)} min
          </AppText>
          <AppText variant="caption" tone="muted">
            Across {starts.length} recorded nights
          </AppText>
        </Card>
      )}
      <Card>
        <AppText variant="eyebrow" tone="muted">
          Sleep trends · last 14 nights
        </AppText>
        <SegmentedControl
          appearance="tabs"
          size="xs"
          label="Sleep trend"
          value={view}
          onChange={setView}
          options={[
            { label: 'Sleep Stages', value: 'phases' },
            { label: 'Bedtime', value: 'bedtime' },
            { label: 'Wake Time', value: 'wake' },
          ]}
        />
        <StableContent minHeight={theme.sizes.chartHeight + theme.sizes.touchTarget}>
          {view === 'phases' ? (
            <>
              <StackedBarChart
                label="Recorded sleep stages"
                unit="h"
                bars={points.map((point) => {
                  const night = nights.find((night) => night.date === point.label);
                  return {
                    label: point.label,
                    segments: (
                      [
                        ['deepSleepHours', 'Deep', 'deep'],
                        ['lightSleepHours', 'Light', 'light'],
                        ['remSleepHours', 'REM', 'rem'],
                        ['awakHours', 'Awake', 'awake'],
                      ] as const
                    ).flatMap(([field, label, stage]) =>
                      night?.[field] != null
                        ? [{ label, value: night[field]!, color: theme.sleepStages[stage] }]
                        : [],
                    ),
                  };
                })}
              />
              <Stack direction="row" wrap>
                {Object.entries(theme.sleepStages).map(([stage, color]) => (
                  <AppText key={stage} variant="micro" style={{ color }}>
                    {stage.toUpperCase()}
                  </AppText>
                ))}
              </Stack>
            </>
          ) : (
            <>
              <LineChart
                label={view === 'bedtime' ? 'Bedtime' : 'Wake Time'}
                points={points}
                tone="sleep"
              />
              {!!valid.length && (
                <AppText variant="caption" tone="muted">
                  {formatMinutesOfDay(
                    (Math.min(...valid) + (view === 'bedtime' ? 720 : 0)) % 1440,
                  )}{' '}
                  →{' '}
                  {formatMinutesOfDay(
                    (Math.max(...valid) + (view === 'bedtime' ? 720 : 0)) % 1440,
                  )}
                </AppText>
              )}
            </>
          )}
        </StableContent>
      </Card>
    </>
  );
}
