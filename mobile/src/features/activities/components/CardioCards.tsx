import { useState } from 'react';
import { View } from 'react-native';
import { getProtocol } from '@trainingai/shared/fitness-tests/protocols';
import { HR_ZONE_META } from '@trainingai/shared/health/hr-zones';
import {
  maxHrSourceNote,
  restingHrSourceNote,
} from '@trainingai/shared/health/hr-source-copy';
import { formatDateDisplay } from '@trainingai/shared/date-utils';
import {
  OUTCOME_LABEL,
  activityLine,
  countedMinutesLine,
  shownActivity,
} from '@trainingai/shared/running/heart-health-copy';
import { deviceHealthName } from '../../../integrations/device-health/platform';
import {
  AppText,
  Card,
  Grid,
  Icon,
  MetricTile,
  ProgressBar,
  SegmentedControl,
  Stack,
} from '../../../shared/ui';
import { useTheme } from '../../../shared/theme/ThemeProvider';
import type { z } from 'zod';
import { cardioWeekSpec } from '../data/models';
import { weekDayOutcome, type FitnessTest, type HeartHealthDay } from '../data/cardio-view';
type CardioWeek = z.infer<ReturnType<typeof cardioWeekSpec>['schema']>;
export function HeartProfileCard({
  heart,
  hasSource,
}: {
  heart: CardioWeek['heart'];
  hasSource: boolean | null | undefined;
}) {
  const { theme } = useTheme();
  // A zone quota measured against a stand-in max or resting rate says so (LA-82).
  const restingNote = restingHrSourceNote(
    heart.restingHrSource as Parameters<typeof restingHrSourceNote>[0],
  );
  const maxNote = maxHrSourceNote(heart.maxHrSource as Parameters<typeof maxHrSourceNote>[0]);
  const standIns = [
    restingNote?.standIn ? restingNote.detail : null,
    maxNote.standIn ? maxNote.detail : null,
  ].filter((detail): detail is string => !!detail);
  return (
    <Card>
      <Stack direction="row" justify="space-between">
        <AppText variant="eyebrow" tone="muted">
          Your heart
        </AppText>
        <AppText variant="micro" tone="muted">
          last 30 days
        </AppText>
      </Stack>
      <Grid columns={3} gap="xs">
        {(
          [
            [heart.restingHr, 'Resting', heart.restingHrDeltaBpm],
            [heart.avgHr, 'Avg', heart.avgHrDeltaBpm],
            [heart.maxHr, 'Max', heart.maxHrDeltaBpm],
          ] as const
        ).map(([value, label, delta]) => (
          <MetricTile
            compact
            key={label}
            label={label}
            value={value == null ? null : String(value)}
            tone="neutral"
            // Up is red and down is green, as in the current app.
            caption={delta ? `${delta > 0 ? '+' : ''}${delta}` : undefined}
            captionColor={
              delta ? (delta > 0 ? theme.colors.danger : theme.anatomy.main) : undefined
            }
          />
        ))}
      </Grid>
      {standIns.map((detail) => (
        <AppText
          key={detail}
          variant="micro"
          style={{ color: theme.tones.checkin.foreground }}
        >
          {detail}
        </AppText>
      ))}
      {!heart.isReliable && standIns.length === 0 && (
        <AppText variant="micro" tone="muted">
          {hasSource === false
            ? `No heart-rate data yet. Connect ${deviceHealthName} to build your range.`
            : 'Still learning your range — it sharpens with a few more days of heart-rate data.'}
        </AppText>
      )}
    </Card>
  );
}
export function ZoneQuotaCard({ data }: { data: CardioWeek }) {
  const { theme } = useTheme();
  const [view, setView] = useState('day');
  const quota = view === 'day' ? data.dayQuota : data.quota;
  const passive = quota.zones.find((row) => row.zoneId === 1);
  const passiveMeta = HR_ZONE_META.find((zone) => zone.id === 1);
  return (
    <Card>
      <SegmentedControl
        label="Zone quota period"
        value={view}
        onChange={setView}
        options={[
          { value: 'day', label: 'Today' },
          { value: 'week', label: 'This week' },
        ]}
      />
      {data.quota.hasHrSource === false || data.dayQuota.hasHrSource === false ? (
        <AppText variant="caption" tone="muted">
          No heart-rate data yet. Connect {deviceHealthName}, then record a workout.
        </AppText>
      ) : (
        <>
          {quota.zones
            .filter((row) => row.zoneId !== 1)
            .map((row) => {
              const meta = HR_ZONE_META.find((zone) => zone.id === row.zoneId);
              return (
                <Stack
                  key={row.zoneId}
                  gap="xxs"
                  style={row.status === 'not-required' ? { opacity: 0.45 } : undefined}
                >
                  <Stack direction="row" justify="space-between">
                    <Stack direction="row" align="center" gap="xs">
                      <View
                        style={{
                          width: theme.spacing.sm,
                          height: theme.spacing.sm,
                          borderRadius: theme.radii.pill,
                          backgroundColor: meta?.color,
                        }}
                      />
                      <AppText variant="caption">
                        Z{row.zoneId} {meta?.name}
                      </AppText>
                    </Stack>
                    <AppText variant="caption" tone="muted">
                      {row.status === 'not-required'
                        ? 'not needed'
                        : `${row.doneMin} / ${row.targetMin} min`}
                    </AppText>
                  </Stack>
                  <ProgressBar value={row.pctComplete / 100} color={meta?.color} />
                  {row.status !== 'not-required' && (
                    <Stack direction="row" justify="space-between">
                      <AppText variant="micro" tone="muted">
                        {row.pctComplete}% done
                      </AppText>
                      <AppText variant="micro" tone="muted">
                        {row.remainingMin ? `${row.remainingMin} min left` : 'complete'}
                      </AppText>
                    </Stack>
                  )}
                </Stack>
              );
            })}
          {passive && (
            <AppText variant="micro" tone="muted">
              <AppText
                variant="micro"
                style={{
                  color:
                    passive.status === 'complete' ? theme.anatomy.main : passiveMeta?.color,
                }}
              >
                Z1 {passiveMeta?.name}{' '}
                {passive.status === 'complete'
                  ? 'complete'
                  : `${passive.doneMin}/${passive.targetMin} min`}
              </AppText>{' '}
              — Zone 1 fills from ordinary daily movement, so it isn’t counted toward your
              training week.
            </AppText>
          )}
        </>
      )}
    </Card>
  );
}
export function StepsQuotaCard({ steps }: { steps: CardioWeek['steps'] }) {
  return (
    <Card>
      <AppText variant="eyebrow" tone="muted">
        Steps
      </AppText>
      <Grid gap="sm">
        {(
          [
            [steps.today, steps.todayGoal, 'today'],
            [steps.week, steps.weekGoal, 'wk'],
          ] as const
        ).map(([value, goal, label]) => (
          <Stack key={label}>
            <AppText variant="caption">
              {value.toLocaleString()} / {goal.toLocaleString()} {label}
            </AppText>
            <ProgressBar value={goal > 0 ? value / goal : 0} />
          </Stack>
        ))}
      </Grid>
    </Card>
  );
}

/** The compact Cardio Baselines figures (6MWT, HRR, Cooper...) in one wrapping row. */
export function BaselinesRow({ tests }: { tests: readonly FitnessTest[] }) {
  return (
    <Stack direction="row" wrap gap="lg">
      {tests.map((row) => {
        const protocol = getProtocol(row.testType);
        const vo2 = !!protocol?.vo2Equation;
        const value = vo2 ? row.vo2maxEst : row.hrr1Bpm;
        return (
          <View key={row.testType}>
            <AppText variant="micro" tone="muted">
              {protocol?.shortName ?? row.testType}
            </AppText>
            <AppText variant="metric" style={{ fontVariant: ['tabular-nums'] }}>
              {value ?? '—'}
              <AppText variant="micro" tone="muted">
                {' '}
                {vo2 ? 'VO₂max' : 'HRR'}
              </AppText>
            </AppText>
          </View>
        );
      })}
    </Stack>
  );
}

/** Shown on a day with no dedicated workout but some Zone 1 movement. */
export function LazyDayCreditCard({ zone1Min }: { zone1Min: number }) {
  const { theme } = useTheme();
  if (zone1Min <= 0) return null;
  return (
    <Card>
      <Stack direction="row" align="flex-start">
        <Icon
          name="legs"
          size={theme.sizes.iconSmall}
          color={theme.tones.recovery.foreground}
        />
        <AppText variant="caption" style={{ flex: 1 }}>
          <AppText variant="caption" style={{ fontWeight: '700' }}>
            No dedicated workout today — {zone1Min} min moved (Zone 1).
          </AppText>{' '}
          <AppText variant="caption" tone="muted">
            Doesn’t count toward your training quota, but it’s still credit for staying active.
          </AppText>
        </AppText>
      </Stack>
    </Card>
  );
}

/** This week's days, oldest first: what each day counted, as the current app lists them. */
export function WeekList({ days, today }: { days: readonly HeartHealthDay[]; today: string }) {
  const { theme } = useTheme();
  if (!days.length) return null;
  return (
    <Stack gap="xs">
      <AppText variant="eyebrow" tone="muted">
        This week
      </AppText>
      {days.map((day) => {
        const outcome = weekDayOutcome(day, today);
        const shown = shownActivity(day.activities, day.creditedId);
        const sub = countedMinutesLine(day.activities, day.countedMin);
        const color =
          outcome === 'counted'
            ? theme.anatomy.main
            : outcome === 'not-counted'
              ? theme.anatomy.secondary
              : theme.colors.muted;
        return (
          <Card key={day.runId} style={{ padding: theme.spacing.sm }}>
            <Stack direction="row" align="center">
              <AppText variant="caption" tone="muted" style={{ width: theme.spacing.xxxl }}>
                {formatDateDisplay(day.date.replace(/\//g, '-'), 'weekday')}
              </AppText>
              <View style={{ flex: 1 }}>
                <AppText variant="caption" numberOfLines={1}>
                  {shown ? activityLine(shown) : 'No activity logged'}
                </AppText>
                {sub !== '' && (
                  <AppText variant="micro" tone="muted">
                    {sub}
                  </AppText>
                )}
              </View>
              <AppText variant="caption" style={{ color, fontWeight: '600' }}>
                {OUTCOME_LABEL[outcome]}
              </AppText>
            </Stack>
          </Card>
        );
      })}
    </Stack>
  );
}
