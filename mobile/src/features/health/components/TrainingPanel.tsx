import { HealthResourceHeader } from './HealthResourceHeader';
import { useState, type ReactNode } from 'react';
import { shiftDateStr, startOfWeekInTz, weekStartForDay } from '@trainingai/shared/date-utils';
import { plural } from '@trainingai/shared/format/plural';
import {
  AppText,
  Card,
  Icon,
  LineChart,
  ListRow,
  HubCard,
  ProgressBar,
  Sheet,
  Stack,
  TouchSurface,
} from '../../../shared/ui';
import { useTheme } from '../../../shared/theme/ThemeProvider';
import { useWorkoutResource } from '../../workouts/data/WorkoutDataProvider';
import { weeklySpec } from '../../workouts/data/models';
import { WeeklyTrainingCard } from '../../progress/WeeklyTrainingCard';
import { ResourceStatus } from '../../workouts/components/ResourceStatus';
import { SessionGlyph } from '../../workouts/components/SessionGlyph';
import { useHealthData } from '../data/HealthDataProvider';
import {
  activityHistorySpec,
  movementSpec,
  muscleSetsSpec,
  overviewSpec,
  trendsSpec,
} from '../data/models';
import {
  activityRow,
  movementRows,
  periodizationRow,
  trendSeries,
  weekActivities,
} from '../data/training-view';
import { useReadableCueColor } from './RangeBar';
import { ActivityDetails, type HealthActivity } from './ActivityDetails';
import { MuscleVolumeFigure, muscleVolumeCaption } from './MuscleVolumeFigure';
import { TrainingCalendarCard } from './TrainingCalendarCard';
import { activityIcon, activityTypesSpec } from '../../activities/data/models';
import { useActivityLogs } from '../../activities/data/ActivityProvider';

function MovementCard() {
  const { today } = useHealthData();
  const state = useWorkoutResource(movementSpec(shiftDateStr(today, -59), today));
  const { theme } = useTheme();
  const balance = movementRows(state.data?.muscles ?? []);
  return (
    <Card>
      <HealthResourceHeader title={'Movement Balance'} state={state} refresh={state.refresh} />
      <AppText variant="caption" tone="muted">
        Last 60 days · weighted sets
      </AppText>

      {state.data && balance.total === 0 && (
        <AppText variant="caption" tone="muted">
          No sets logged in the last 60 days
        </AppText>
      )}
      {state.data &&
        balance.total > 0 &&
        balance.rows.map((row) => {
          // One accent for the three patterns (they are categories, not a scale); "other" stays muted.
          const color = row.key === 'other' ? theme.colors.muted : theme.training.movement;
          return (
            <Stack key={row.key} gap="xs">
              <Stack direction="row" justify="space-between">
                <AppText variant="label">{row.label}</AppText>
                <AppText variant="caption" tone="muted">
                  {row.percent}
                  <AppText variant="caption" style={{ color, fontWeight: '600' }}>
                    {' '}
                    {row.sets}
                  </AppText>
                </AppText>
              </Stack>
              <ProgressBar value={row.fraction} color={color} />
            </Stack>
          );
        })}
    </Card>
  );
}

// Duration and density over the last 14 days. The value axis, weekday names and the "N days
// missing" note are on, so a gap reads as a gap and the line reads against round values; only a
// reading with no neighbour gets a dot, as in the current app.
function TrendChartCard({
  title,
  series,
  color,
  status,
}: {
  title: string;
  series: NonNullable<ReturnType<typeof trendSeries>>;
  color: string;
  status?: ReactNode;
}) {
  const cueColor = useReadableCueColor();
  const { change } = series;
  // trend-sparkline.tsx: "Title — 14 days" with the missing-days note beside it and the change
  // since last week at the right, all on one row.
  return (
    <Card>
      <Stack direction="row" justify="space-between" align="center" gap="sm">
        <AppText
          variant="eyebrow"
          tone="muted"
          accessibilityRole="header"
          style={{ flex: 1, letterSpacing: 0.5 }}
        >
          {title} — 14 days
          {series.missing ? (
            <AppText
              variant="eyebrow"
              tone="muted"
              style={{ textTransform: 'none', letterSpacing: 0, fontWeight: '400', opacity: 0.7 }}
            >
              {'  '}
              {series.missing}
            </AppText>
          ) : null}
        </AppText>
        {change && (
          <AppText
            variant="micro"
            tone={change.direction === 'same' ? 'muted' : undefined}
            style={
              change.direction === 'same'
                ? undefined
                : { color: cueColor(change.direction === 'up' ? 'good' : 'bad') }
            }
          >
            {change.text}
          </AppText>
        )}
        {status}
      </Stack>
      <LineChart
        label={title}
        points={series.points}
        axisLabels={series.axisLabels}
        color={color}
        fillColor={`${color}33`}
        fill
        readable
        yAxis
        niceBounds
        dots="isolated"
        smooth
      />
    </Card>
  );
}

export function TrainingPanel({
  openPrograms,
  openDay,
  openWeek,
}: {
  openPrograms: () => void;
  openDay: (date: string) => void;
  openWeek: (week: string) => void;
}) {
  const { today, timezone } = useHealthData();
  const { theme } = useTheme();
  const weekly = useWorkoutResource(weeklySpec);
  const muscles = useWorkoutResource(muscleSetsSpec);
  const overview = useWorkoutResource(overviewSpec);
  const activity = useWorkoutResource(activityHistorySpec);
  const activityTypes = useWorkoutResource(activityTypesSpec);
  const activityLogs = useActivityLogs(
    activity.data?.activityLogs ?? [],
    shiftDateStr(today, -29),
    today,
  );
  const thisWeek = weekActivities(activityLogs, startOfWeekInTz(timezone));
  const [selectedActivity, setSelectedActivity] = useState<HealthActivity | null>(null);
  const trends = useWorkoutResource(trendsSpec(today));
  const duration = trendSeries(trends.data?.trends, (day) => day.sessionDurationMin);
  const density = trendSeries(trends.data?.trends, (day) => day.workoutDensity);
  const phaseColors: Record<string, string> = theme.training.phases;
  const trendStatus = (
    <ResourceStatus inline label="Workout trends" state={trends} refresh={trends.refresh} />
  );
  return (
    <>
      <TrainingCalendarCard openDay={openDay} />
      <HubCard
        title="Week in review"
        subtitle="Last week's training, recovery and records"
        icon="calendarRange"
        tone="neutral"
        iconTile={false}
        onPress={() => openWeek(shiftDateStr(weekStartForDay(today), -7))}
      />
      {weekly.data && (
        <WeeklyTrainingCard
          readable
          data={weekly.data}
          status={
            <ResourceStatus inline label="Training load" state={weekly} refresh={weekly.refresh} />
          }
        />
      )}
      {!weekly.data && (
        <HealthResourceHeader title="Training Load" state={weekly} refresh={weekly.refresh} />
      )}
      <Card>
        <HealthResourceHeader
          title={'AI Periodization'}
          state={overview}
          refresh={overview.refresh}
          icon="coach"
        />
        {overview.data?.sessions.map((session, position) => {
          const row = periodizationRow(session);
          return (
            <TouchSurface
              key={session.sessionId}
              accessibilityRole="button"
              accessibilityLabel={`${session.sessionName}, ${row.label}`}
              onPress={openPrograms}
            >
              <Stack
                direction="row"
                align="center"
                style={{
                  borderRadius: theme.radii.control,
                  backgroundColor: `${theme.colors.background}99`,
                  paddingHorizontal: theme.spacing.md,
                  paddingVertical: theme.spacing.sm,
                }}
              >
                <SessionGlyph
                  icon={session.icon}
                  position={position}
                  size={theme.sizes.iconSmall}
                  color={theme.colors.muted}
                />
                <Stack gap="none" style={{ flex: 1, minWidth: 0 }}>
                  <AppText variant="label" numberOfLines={1}>
                    {session.sessionName}
                  </AppText>
                  <AppText variant="micro" style={{ color: phaseColors[row.phase] }}>
                    {row.label}
                  </AppText>
                </Stack>
                {row.recency ? (
                  <AppText variant="micro" tone="muted">
                    {row.recency}
                  </AppText>
                ) : null}
              </Stack>
            </TouchSurface>
          );
        })}
        {overview.data && !overview.data.sessions.length && (
          <AppText variant="caption" tone="muted">
            No AI dynamic program active
          </AppText>
        )}
      </Card>
      <Card>
        <HealthResourceHeader
          title={'Muscle Volume This Week'}
          state={muscles}
          refresh={muscles.refresh}
          caption={muscles.data?.muscles.length ? muscleVolumeCaption(muscles.data.muscles) : undefined}
        />
        {!!muscles.data?.muscles.length && <MuscleVolumeFigure muscles={muscles.data.muscles} />}
        {muscles.data && !muscles.data.muscles.length && (
          <AppText variant="caption" tone="muted">
            No muscle volume recorded this week
          </AppText>
        )}
      </Card>
      <MovementCard />
      <Card padded={false} style={{ gap: 0 }}>
        <Stack
          direction="row"
          justify="space-between"
          align="center"
          style={{
            paddingHorizontal: theme.spacing.lg,
            paddingVertical: theme.spacing.md,
            borderBottomWidth: 1,
            borderColor: theme.colors.border,
          }}
        >
          <AppText
            variant="cardTitle"
            accessibilityRole="header"
            style={{ flex: 1, color: theme.colors.brandText }}
          >
            Activities This Week
          </AppText>
          {thisWeek.length > 0 && (
            <AppText variant="micro" tone="muted">
              {plural(thisWeek.length, 'session', 'sessions')}
            </AppText>
          )}
          <ResourceStatus
            inline
            label="Activities This Week"
            state={activity}
            refresh={activity.refresh}
          />
        </Stack>
        {thisWeek.map((log, index) => {
          const row = activityRow(log);
          const icon = activityTypes.data?.activityTypes.find(
            (type) => type.id === log.activityType,
          )?.icon;
          return (
            <ListRow
              key={log.id}
              title={row.title}
              subtitle={row.subtitle}
              divider={index < thisWeek.length - 1}
              leading={<Icon name={activityIcon(icon ?? '')} tone="muted" />}
              trailing={
                row.facts.length ? (
                  <Stack gap="none" align="flex-end">
                    {row.facts.map((fact) => (
                      <AppText key={fact} variant="caption" tone="muted">
                        {fact}
                      </AppText>
                    ))}
                  </Stack>
                ) : undefined
              }
              onPress={() => setSelectedActivity(log)}
            />
          );
        })}
        {activity.data && !thisWeek.length && (
          <AppText
            variant="caption"
            tone="muted"
            style={{ textAlign: 'center', padding: theme.spacing.lg }}
          >
            No activities this week
          </AppText>
        )}
      </Card>
      <Sheet
        fullHeight
        visible={selectedActivity !== null}
        title={selectedActivity?.title ?? 'Activity'}
        onClose={() => setSelectedActivity(null)}
      >
        {selectedActivity && <ActivityDetails log={selectedActivity} />}
      </Sheet>
      {duration && (
        <TrendChartCard
          title="Session Duration"
          series={duration}
          color={theme.colors.brand}
          status={trendStatus}
        />
      )}
      {density && (
        <TrendChartCard
          title="Workout Density"
          series={density}
          color={theme.scores.activity}
          status={duration ? undefined : trendStatus}
        />
      )}
      {!duration && !density && (
        <Card>
          <HealthResourceHeader title="Workout Density" state={trends} refresh={trends.refresh} />
          {trends.data && (
            <AppText variant="caption" tone="muted">
              No workout density trends yet.
            </AppText>
          )}
        </Card>
      )}
    </>
  );
}
