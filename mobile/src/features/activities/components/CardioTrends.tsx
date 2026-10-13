import { useState } from 'react';
import { HR_ZONE_META } from '@trainingai/shared/health/hr-zones';
import { zoneStacksUnmeasured } from '@trainingai/shared/health/cardio-trends';
import {
  AppText,
  Card,
  LineChart,
  SegmentedControl,
  StableContent,
  StackedBarChart,
  StatusIndicator,
} from '../../../shared/ui';
import { useTheme } from '../../../shared/theme/ThemeProvider';
import { useWorkoutResource } from '../../workouts/data/WorkoutDataProvider';
import { cardioTrendsSpec } from '../data/models';
export function CardioTrends() {
  const state = useWorkoutResource(cardioTrendsSpec),
    data = state.data;
  const { theme } = useTheme();
  const [view, setView] = useState('zones');
  const efficiency = data?.efficiencyCurve ?? [];
  const paceValues = efficiency.map((p) => p.avgPaceSecPerKm);
  const maxPace = Math.max(1, ...paceValues),
    minPace = Math.min(...paceValues);
  const hrPoints = efficiency.map((p, i) => ({ x: i, label: p.date.slice(5), value: p.avgHr }));
  return (
    <Card>
      <AppText variant="eyebrow" tone="muted">
        Trends
      </AppText>
      <SegmentedControl
        label="Cardio trend"
        value={view}
        onChange={setView}
        options={[
          { value: 'zones', label: 'Zone minutes' },
          { value: 'efficiency', label: 'Efficiency' },
          { value: 'cadence', label: 'Cadence' },
        ]}
      />
      <StableContent
        frameHeight={theme.sizes.chartHeight + theme.sizes.touchTarget}
        loading={!data && state.loading}
      >
        {!data ? (
          <AppText tone="muted">Could not load your trends.</AppText>
        ) : view === 'zones' ? (
          zoneStacksUnmeasured(
            data.weeklyZoneStacks.map((row) => ({
              ...row,
              seconds: row.seconds as [number, number, number, number, number],
            })),
            data.hasHrSource,
          ) ? (
            <AppText variant="caption" tone="muted">
              No heart-rate data yet. Connect Apple Health, then record a workout.
            </AppText>
          ) : data.weeklyZoneStacks.length ? (
            <StackedBarChart
              label="Weekly zone minutes"
              unit="min"
              bars={data.weeklyZoneStacks.map((week) => ({
                label: week.weekStart.slice(5),
                segments: week.seconds.map((sec, index) => ({
                  label: `Z${index + 1}`,
                  value: sec / 60,
                  color: HR_ZONE_META[index].color,
                })),
              }))}
            />
          ) : (
            <AppText tone="muted">Not enough history yet — keep logging zone minutes.</AppText>
          )
        ) : view === 'efficiency' ? (
          efficiency.length ? (
            <>
              <LineChart
                label="Average heart rate and pace"
                points={hrPoints}
                interactive
                color={theme.tones.heart.foreground}
                series={[
                  {
                    label: 'Pace (sec/km, faster is higher)',
                    color: theme.colors.brand,
                    domain: [-maxPace, -minPace],
                    points: efficiency.map((p, i) => ({ x: i, value: -p.avgPaceSecPerKm })),
                  },
                ]}
              />
              <AppText variant="micro" tone="muted">
                Falling HR at a similar (or faster) pace over time means better aerobic
                efficiency.
              </AppText>
            </>
          ) : (
            <AppText tone="muted">No runs with HR data yet.</AppText>
          )
        ) : data.cadenceTrend.length ? (
          <LineChart
            label="Run cadence (spm)"
            points={data.cadenceTrend.map((row) => ({
              label: row.date.slice(5),
              value: row.cadenceSpm,
            }))}
            interactive
          />
        ) : (
          <AppText tone="muted">No cadence readings yet.</AppText>
        )}
      </StableContent>
      <StatusIndicator
        label="Cardio trends"
        error={state.error}
        busy={state.refreshing}
        onRetry={state.refresh}
      />
    </Card>
  );
}
