import { useActivities } from '../../activities/data/ActivityProvider';
import { Pressable, View } from 'react-native';
import { formatHoursMinutes } from '@trainingai/shared/format/units';
import { formatTimeOfDay, shiftDateStr } from '@trainingai/shared/date-utils';
import { dayTimeInstant } from '../../health/data/manual-night';
import { AppText, Card, Icon, Stack, StatusIndicator, type IconName } from '../../../shared/ui';
import { useWorkoutResource } from '../../workouts/data/WorkoutDataProvider';
import { useHealthData } from '../../health/data/HealthDataProvider';
import { useWorkoutJournal } from '../../workouts/logging/WorkoutJournalProvider';
import { useNutrition } from '../../nutrition/data/NutritionProvider';
import { useTheme } from '../../../shared/theme/ThemeProvider';
import { localTimeline, timelineSchema, type TimelineEvent } from '../data/timeline';
export function HomeTimeline({
  openDay,
  openNutrition,
  openSleep,
}: {
  openDay: (date: string) => void;
  openNutrition: (date: string) => void;
  openSleep: (date: string) => void;
}) {
  const health = useHealthData();
  const journal = useWorkoutJournal();
  const n = useNutrition();
  const activity = useActivities();
  const { theme } = useTheme();
  const today = health.today;
  const state = useWorkoutResource({
    path: '/api/day-timeline',
    query: { date: today },
    schema: timelineSchema,
    ttl: 60_000,
  });
  let events = localTimeline(
    state.data?.events ?? [],
    journal.data.workouts,
    health.sleep,
    today,
    health.timezone,
  );
  for (const row of activity.rows) {
    const log = row.payload;
    if (
      !row.pending ||
      !log.startTime ||
      ![today, shiftDateStr(today, -1)].includes(log.date)
    ) {
      continue;
    }
    const timeMs = Date.parse(dayTimeInstant(log.date, log.startTime, health.timezone) ?? '');
    if (!Number.isFinite(timeMs)) {
      continue;
    }
    events = events.filter(
      (event) =>
        !(
          ['activity', 'cardio', 'walk'].includes(event.type) &&
          Math.abs(event.timeMs - timeMs) < 60000
        ),
    );
    events.push({
      type: 'activity',
      timeMs,
      time: formatTimeOfDay(timeMs, health.timezone),
      date: log.date,
      day: log.date === today ? 'today' : 'yesterday',
      title: log.title,
      durationMin: log.durationMin,
      distanceKm: log.distanceKm,
      subtitle: 'Saved on this phone',
    });
  }
  for (const date of [today, shiftDateStr(today, -1)]) {
    const operations = n.operations.filter(
      (op) => op.domain === 'food_logs' && op.date === date,
    );
    if (!operations.length || !n.data.days[date]) {
      continue;
    }
    const affected = new Set(
      operations.flatMap((op) =>
        [
          op.payload.mealTypeId,
          n.data.days[date]?.find((row) => row.id === op.payload.id)?.mealTypeId,
        ].filter((value): value is string => typeof value === 'string'),
      ),
    );
    const view = n.store?.view(date);
    if (!view) {
      continue;
    }
    for (const id of affected) {
      const meal = n.view.mealTypes.find((row) => row.id === id);
      if (!meal) {
        continue;
      }
      const logs = view.logs.filter((row) => row.mealTypeId === id);
      const removePrevious = () =>
        events.filter(
          (event) =>
            !(
              event.type === 'meal' &&
              (event.date ?? (event.day === 'today' ? today : shiftDateStr(today, -1))) ===
                date &&
              event.title.endsWith(meal.name)
            ),
        );
      if (!logs.length) {
        events = removePrevious();
        continue;
      }
      const hour = (value: number) => String(value).padStart(2, '0');
      const start = Date.parse(
        dayTimeInstant(date, `${hour(meal.timeStartHour ?? 0)}:00:00`, health.timezone) ?? '',
      );
      const end = Date.parse(
        dayTimeInstant(
          date,
          `${hour(meal.timeEndHour === 24 ? 23 : (meal.timeEndHour ?? 23))}:${meal.timeEndHour === 24 ? '59' : '00'}:00`,
          health.timezone,
        ) ?? '',
      );
      const inWindow = logs
        .map((row) => Date.parse(row.loggedAt))
        .filter((at) => at >= start && at <= end);
      const timeMs = inWindow.length ? Math.max(...inWindow) : end;
      if (!Number.isFinite(timeMs)) {
        continue;
      }
      events = removePrevious();
      events.push({
        type: 'meal',
        timeMs,
        time: formatTimeOfDay(timeMs, health.timezone),
        title: `${meal.emoji ?? ''} ${meal.name}`.trim(),
        day: date === today ? 'today' : 'yesterday',
        date,
        calories: Math.round(logs.reduce((sum, row) => sum + row.calories, 0)),
        subtitle: 'Saved on this phone',
      });
    }
  }
  events.sort((a, b) => b.timeMs - a.timeMs);
  if (!events.length && !state.loading && !state.error) {
    return null;
  }
  const icons: Record<string, IconName> = {
    wakeup: 'power',
    sleep: 'moon',
    bedtime: 'moon',
    workout: 'workout',
    meal: 'nutrition',
    walk: 'legs',
    tag: 'info',
  };
  return (
    <Stack>
      <Stack direction="row" align="center" justify="space-between">
        <AppText variant="eyebrow" tone="muted">
          Today’s Timeline
        </AppText>
        <StatusIndicator
          label="Today’s timeline"
          error={state.error}
          onRetry={state.refresh}
          busy={state.loading && !state.data}
        />
      </Stack>
      {events.map((event, index) => (
        <Stack key={`${event.type}:${event.timeMs}:${index}`}>
          {event.day === 'yesterday' && events[index - 1]?.day !== 'yesterday' && (
            <AppText variant="eyebrow" tone="muted">
              Yesterday
            </AppText>
          )}
          <Stack direction="row" align="flex-start">
            <Stack align="center" style={{ width: theme.sizes.touchTarget }}>
              <AppText variant="micro" tone="muted">
                {event.time}
              </AppText>
              <Icon name={icons[event.type] ?? 'activity'} tone="brand" />
            </Stack>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={event.title}
              onPress={
                event.type === 'meal'
                  ? () =>
                      openNutrition(
                        event.date ?? (event.day === 'today' ? today : shiftDateStr(today, -1)),
                      )
                  : ['wakeup', 'sleep', 'bedtime'].includes(event.type)
                    ? () =>
                        openSleep(
                          event.sleepDate ??
                            health.sleep.find(
                              (night) =>
                                night.sleepStart &&
                                night.sleepEnd &&
                                event.timeMs >= Date.parse(night.sleepStart) &&
                                event.timeMs <= Date.parse(night.sleepEnd),
                            )?.date ??
                            event.date ??
                            (event.day === 'today' ? today : shiftDateStr(today, -1)),
                        )
                    : () =>
                        openDay(
                          event.date ??
                            (event.day === 'today' ? today : shiftDateStr(today, -1)),
                        )
              }
              style={{ flex: 1 }}
            >
              <Card>
                <AppText variant="label">{event.title}</AppText>
                <Stack direction="row" wrap>
                  {event.durationMin != null && (
                    <AppText variant="caption" tone="muted">
                      {event.durationMin} min
                    </AppText>
                  )}
                  {event.sets != null && (
                    <AppText variant="caption" tone="muted">
                      {event.sets} sets
                    </AppText>
                  )}
                  {event.exerciseCount != null && (
                    <AppText variant="caption" tone="muted">
                      {event.exerciseCount} exercises
                    </AppText>
                  )}
                  {event.distanceKm != null && (
                    <AppText variant="caption" tone="muted">
                      {event.distanceKm.toFixed(2)} km
                    </AppText>
                  )}
                  {event.calories != null && (
                    <AppText variant="caption" tone="muted">
                      {event.calories} kcal
                    </AppText>
                  )}
                  {event.sleepDurationH != null && (
                    <AppText variant="caption" tone="muted">
                      {formatHoursMinutes(event.sleepDurationH * 60)} sleep
                    </AppText>
                  )}
                </Stack>
                {(event.readinessScore != null || event.sleepScore != null) && (
                  <Stack direction="row">
                    {event.readinessScore != null && (
                      <AppText variant="caption">Energy {event.readinessScore}</AppText>
                    )}
                    {event.sleepScore != null && (
                      <AppText variant="caption">Sleep {event.sleepScore}</AppText>
                    )}
                  </Stack>
                )}
                {event.subtitle && (
                  <AppText variant="micro" tone="muted">
                    {event.subtitle}
                  </AppText>
                )}
              </Card>
            </Pressable>
          </Stack>
        </Stack>
      ))}
    </Stack>
  );
}
