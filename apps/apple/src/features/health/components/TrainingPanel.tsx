import { HealthResourceHeader } from './HealthResourceHeader';
import { useState } from 'react';
import { shiftDateStr, weekStartForDay } from '@trainingai/shared/date-utils';
import { movementPattern } from '@trainingai/shared/muscles';
import {
  AppText,
  Card,
  ListRow,
  MonthCalendar,
  ProgressBar,
  Sheet,
  Stack,
} from '../../../shared/ui';
import { useWorkoutResource } from '../../workouts/data/WorkoutDataProvider';
import { calendarSpec, weeklySpec } from '../../workouts/data/models';
import { useWorkoutJournal } from '../../workouts/logging/WorkoutJournalProvider';
import { WeeklyTrainingCard } from '../../progress/WeeklyTrainingCard';
import { ResourceStatus } from '../../workouts/components/ResourceStatus';
import { useHealthData } from '../data/HealthDataProvider';
import {
  activityHistorySpec,
  movementSpec,
  muscleSetsSpec,
  overviewSpec,
  trendsSpec,
  metricValue,
} from '../data/models';
import { HealthMetricCard } from './HealthMetricCard';
import { ActivityDetails, type HealthActivity } from './ActivityDetails';

import { useActivities, useActivityLogs } from '../../activities/data/ActivityProvider';

function CalendarCard({ openDay }: { openDay: (date: string) => void }) {
  const { today } = useHealthData();
  const [month, setMonth] = useState(today.slice(0, 7));
  const [selected, setSelected] = useState<string | null>(null);
  const [year, number] = month.split('-').map(Number);
  const state = useWorkoutResource(calendarSpec(year, number));
  const journal = useWorkoutJournal();
  const activities = useActivities();
  const markers: Record<string, string[]> = {};
  for (const row of activities.rows) {
    if (row.payload.date.startsWith(month)) {
      markers[row.payload.date] = [row.payload.title];
    }
  }
  for (const source of [state.data?.trainedDays ?? {}, state.data?.activityDays ?? {}]) {
    for (const [date, names] of Object.entries(source)) {
      const day = date.replace(/\//g, '-');
      markers[day] = [...(markers[day] ?? []), ...names];
    }
  }
  for (const workout of journal.data.workouts.filter(
    (workout) => workout.status === 'completed' && workout.date.startsWith(month),
  )) {
    markers[workout.date] = [
      ...new Set([...(markers[workout.date] ?? []), workout.sessionName]),
    ];
  }
  return (
    <Card>
      <AppText variant="eyebrow" tone="muted">
        Training Calendar
      </AppText>
      <MonthCalendar
        status={
          <ResourceStatus
            inline
            label="Calendar records"
            state={state}
            refresh={state.refresh}
          />
        }
        today={today}
        month={month}
        markers={markers}
        selected={selected ?? undefined}
        onMonthChange={setMonth}
        onSelect={(date) => {
          setSelected(date);
          openDay(date);
        }}
      />
    </Card>
  );
}
function MovementCard() {
  const { today } = useHealthData();
  const state = useWorkoutResource(movementSpec(shiftDateStr(today, -59), today));
  const totals = { push: 0, pull: 0, legs: 0, other: 0 };
  for (const row of state.data?.muscles ?? []) {
    if (row.sets > 0) {
      totals[movementPattern(row.muscle)] += row.sets;
    }
  }
  const total = Object.values(totals).reduce((sum, value) => sum + value, 0);
  return (
    <Card>
      <HealthResourceHeader title={'Movement Balance'} state={state} refresh={state.refresh} />
      <AppText variant="caption" tone="muted">
        Last 60 days · weighted sets
      </AppText>

      {state.data &&
        Object.entries(totals).map(([key, value]) => (
          <Stack key={key}>
            <Stack direction="row" justify="space-between">
              <AppText variant="caption">{key === 'other' ? 'Core & other' : key}</AppText>
              <AppText variant="caption">
                {metricValue(value, 'sets', 1)} ·{' '}
                {total ? Math.round((value / total) * 100) : 0}%
              </AppText>
            </Stack>
            <ProgressBar value={total ? value / total : 0} />
          </Stack>
        ))}
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
  const { today } = useHealthData();
  const weekly = useWorkoutResource(weeklySpec);
  const muscles = useWorkoutResource(muscleSetsSpec);
  const overview = useWorkoutResource(overviewSpec);
  const activity = useWorkoutResource(activityHistorySpec);
  const activityLogs = useActivityLogs(
    activity.data?.activityLogs ?? [],
    shiftDateStr(today, -29),
    today,
  );
  const [selectedActivity, setSelectedActivity] = useState<HealthActivity | null>(null);
  const trends = useWorkoutResource(trendsSpec(today));
  return (
    <>
      <CalendarCard openDay={openDay} />
      <Card padded={false}>
        <ListRow
          title="Week in review"
          subtitle="Last week’s training, recovery and records"
          onPress={() => openWeek(shiftDateStr(weekStartForDay(today), -7))}
        />
      </Card>
      {weekly.data && (
        <WeeklyTrainingCard
          data={weekly.data}
          status={
            <ResourceStatus
              inline
              label="Training load"
              state={weekly}
              refresh={weekly.refresh}
            />
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
        />

        {overview.data?.sessions.map((session) => (
          <ListRow
            key={session.sessionId}
            title={session.sessionName}
            subtitle={`${session.state?.phase ?? session.state?.currentPhase ?? 'Baseline'} · ${session.lastTrainedDaysAgo === null ? 'Never trained' : `${session.lastTrainedDaysAgo} days ago`}`}
            onPress={openPrograms}
          />
        ))}
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
        />

        {muscles.data?.phase?.dominant && (
          <AppText variant="caption" tone="muted">
            {muscles.data.phase.dominant} · target scale {muscles.data.phase.scale}
          </AppText>
        )}
        {muscles.data?.muscles.map((row) => (
          <Stack key={row.muscle}>
            <Stack direction="row" justify="space-between">
              <AppText variant="caption">{row.muscle}</AppText>
              <AppText variant="caption">
                {row.sets} sets{row.target !== null ? ` / ${row.target}` : ''}
              </AppText>
            </Stack>
            {row.target !== null && row.target > 0 && (
              <ProgressBar value={row.sets / row.target} />
            )}
          </Stack>
        ))}
        {muscles.data && !muscles.data.muscles.length && (
          <AppText variant="caption" tone="muted">
            No muscle volume recorded this week
          </AppText>
        )}
      </Card>
      <MovementCard />
      <Card>
        <HealthResourceHeader
          title={'Activity History'}
          state={activity}
          refresh={activity.refresh}
        />

        {activityLogs.map((log) => (
          <ListRow
            key={log.id}
            title={log.title ?? log.activityType}
            subtitle={`${log.date} · ${metricValue(log.durationMin, 'min')} · ${metricValue(log.distanceKm, 'km', 1)}`}
            onPress={() => setSelectedActivity(log)}
          />
        ))}
        {activity.data && !activityLogs.length && (
          <AppText variant="caption" tone="muted">
            No activities recorded in the last 30 days
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
      <HealthMetricCard
        title="Workout Density"
        caption="kg lifted per active minute · last 14 days"
        points={trends.data?.trends.map((day) => ({
          label: day.date,
          value: day.workoutDensity,
        }))}
        status={
          <ResourceStatus
            inline
            label="Workout Density"
            state={trends}
            refresh={trends.refresh}
          />
        }
      ></HealthMetricCard>
    </>
  );
}
