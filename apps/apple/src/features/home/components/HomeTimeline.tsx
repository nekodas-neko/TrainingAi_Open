import { useActivities } from '../../activities/data/ActivityProvider';
import { useRef, useState } from 'react';
import { formatTimeOfDay, shiftDateStr } from '@trainingai/shared/date-utils';
import { dayTimeInstant } from '../../health/data/manual-night';
import {
  AppButton,
  AppText,
  Sheet,
  Stack,
  StatusIndicator,
  TimelineRow,
  type IconName,
} from '../../../shared/ui';
import type { Tone } from '../../../shared/theme/theme';
import { useWorkoutResource } from '../../workouts/data/WorkoutDataProvider';
import { useHealthData } from '../../health/data/HealthDataProvider';
import { useWorkoutJournal } from '../../workouts/logging/WorkoutJournalProvider';
import { useNutrition } from '../../nutrition/data/NutritionProvider';
import { useTheme } from '../../../shared/theme/ThemeProvider';
import { localTimeline, timelineSchema, type TimelineEvent } from '../data/timeline';
import {
  isSleepEvent,
  timelineDestinationDate,
  timelineSleepNight,
  timelineSummary,
  timelineTitle,
} from '../data/timeline-presentation';
import { TimelineEventDetails } from './TimelineEventDetails';
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
  const [selected, setSelected] = useState<TimelineEvent | null>(null);
  const [closing, setClosing] = useState(false);
  const pendingNavigation = useRef<(() => void) | null>(null);
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
  if (!events.length && !state.loading && !state.error && !selected) {
    return null;
  }
  function destination(event: TimelineEvent) {
    const date = timelineDestinationDate(event, today, health.sleep);
    if (event.type === 'meal') openNutrition(date);
    else if (isSleepEvent(event)) openSleep(date);
    else openDay(date);
  }
  function appearance(event: TimelineEvent): { icon: IconName; tone: Tone; color?: string } {
    if (isSleepEvent(event))
      return {
        icon: event.type === 'wakeup' ? 'sunrise' : 'moon',
        tone: 'sleep',
        color: theme.scores.sleep,
      };
    if (event.type === 'meal')
      return { icon: 'nutrition', tone: 'checkin', color: theme.scores.activity };
    if (event.type === 'workout') return { icon: 'workout', tone: 'brand' };
    if (event.type === 'walk') return { icon: 'legs', tone: 'activity' };
    if (event.type === 'cardio') return { icon: 'cardio', tone: 'recovery' };
    return { icon: event.type === 'tag' ? 'info' : 'activity', tone: 'neutral' };
  }
  return (
    <Stack gap="md">
      <Stack direction="row" align="center" justify="space-between">
        <AppText variant="heading">Timeline</AppText>
        <StatusIndicator
          label="Timeline"
          error={state.error}
          onRetry={state.refresh}
          busy={state.loading && !state.data}
        />
      </Stack>
      {(['today', 'yesterday'] as const).map((day) => {
        const rows = events.filter((event) => event.day === day);
        if (!rows.length) return null;
        return (
          <Stack key={day} gap="xs">
            <AppText variant="eyebrow" tone="muted">
              {day === 'today' ? 'Today' : 'Yesterday'}
            </AppText>
            <Stack gap="none">
              {rows.map((event, index) => (
                <TimelineRow
                  key={event.type + ':' + event.timeMs + ':' + index}
                  time={formatTimeOfDay(event.timeMs, health.timezone)}
                  title={timelineTitle(event)}
                  summary={timelineSummary(event)}
                  savedLocally={event.subtitle === 'Saved on this phone'}
                  {...appearance(event)}
                  first={index === 0}
                  last={index === rows.length - 1}
                  onPress={() => {
                    pendingNavigation.current = null;
                    setClosing(false);
                    setSelected({
                      ...event,
                      date:
                        event.date ?? (event.day === 'today' ? today : shiftDateStr(today, -1)),
                    });
                  }}
                />
              ))}
            </Stack>
          </Stack>
        );
      })}
      <Sheet
        visible={selected !== null && !closing}
        title={selected ? timelineTitle(selected) : 'Event details'}
        onClose={() => {
          pendingNavigation.current = null;
          setSelected(null);
          setClosing(false);
        }}
        onDismiss={() => {
          const navigate = pendingNavigation.current;
          pendingNavigation.current = null;
          setSelected(null);
          setClosing(false);
          navigate?.();
        }}
        footer={
          selected ? (
            <AppButton
              title={
                selected.type === 'meal'
                  ? 'View Nutrition'
                  : isSleepEvent(selected)
                    ? 'View sleep'
                    : 'View day'
              }
              onPress={() => {
                pendingNavigation.current = () => destination(selected);
                setClosing(true);
              }}
            />
          ) : undefined
        }
      >
        {selected && (
          <TimelineEventDetails
            event={selected}
            date={selected.date ?? (selected.day === 'today' ? today : shiftDateStr(today, -1))}
            night={timelineSleepNight(selected, health.sleep)}
            timezone={health.timezone}
          />
        )}
      </Sheet>
    </Stack>
  );
}
