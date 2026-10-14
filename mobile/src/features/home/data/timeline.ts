import { z } from 'zod';
import { formatTimeOfDay, shiftDateStr } from '@trainingai/shared/date-utils';
import type { WorkoutRecord } from '../../workouts/logging/workout.ts';
import type { SleepRow } from '../../health/data/models.ts';
export const timelineEventSchema = z
  .object({
    type: z.string(),
    time: z.string(),
    timeMs: z.number(),
    title: z.string(),
    subtitle: z.string().optional(),
    day: z.enum(['today', 'yesterday']),
    date: z.string().optional(),
    endTime: z.string().optional(),
    durationMin: z.number().optional(),
    calories: z.number().optional(),
    sets: z.number().optional(),
    exerciseCount: z.number().optional(),
    distanceKm: z.number().optional(),
    sleepDurationH: z.number().optional(),
    sleepDate: z.string().optional(),
    sleepScore: z.number().optional(),
    readinessScore: z.number().optional(),
    latencyMin: z.number().optional(),
  })
  .passthrough();
export type TimelineEvent = z.infer<typeof timelineEventSchema>;
export const timelineSchema = z.object({
  date: z.string(),
  events: z.array(timelineEventSchema),
});
export function localTimeline(
  events: readonly TimelineEvent[],
  workouts: readonly WorkoutRecord[],
  sleep: readonly SleepRow[],
  today: string,
  timezone: string,
) {
  const rows = [...events];
  const yesterday = shiftDateStr(today, -1);
  const group = (date: string) =>
    date === today ? ('today' as const) : ('yesterday' as const);
  for (const workout of workouts.filter(
    (row) =>
      row.status === 'completed' &&
      row.pending.length > 0 &&
      (row.date === today || row.date === yesterday),
  )) {
    if (
      rows.some(
        (row) =>
          row.type === 'workout' &&
          row.title === workout.sessionName &&
          Math.abs(row.timeMs - workout.startedAt) < 60_000,
      )
    ) {
      continue;
    }
    rows.push({
      type: 'workout',
      title: workout.sessionName,
      timeMs: workout.startedAt,
      time: formatTimeOfDay(workout.startedAt, timezone),
      date: workout.date,
      day: group(workout.date),
      durationMin:
        workout.completedAt === null
          ? undefined
          : Math.round((workout.completedAt - workout.startedAt) / 60_000),
      sets: workout.exercises.reduce(
        (sum, row) => sum + row.sets.filter((set) => set.completedAt !== null).length,
        0,
      ),
      exerciseCount: workout.exercises.filter((row) =>
        row.sets.some((set) => set.completedAt !== null),
      ).length,
      subtitle: 'Saved on this phone',
    });
  }
  for (const night of sleep.filter(
    (row) => row.localOnly && (row.date === today || row.date === yesterday),
  )) {
    for (const [type, title, at] of [
      ['wakeup', 'Woke up', night.sleepEnd],
      ['sleep', 'Fell asleep', night.sleepStart],
    ] as const) {
      if (!at) {
        continue;
      }
      const timeMs = Date.parse(at);
      const date = type === 'wakeup' ? night.date : formatLocalDate(timeMs, timezone);
      if (
        (date !== today && date !== yesterday) ||
        rows.some(
          (row) =>
            row.type === type &&
            (row.date ?? (row.day === 'today' ? today : yesterday)) === date,
        )
      ) {
        continue;
      }
      rows.push({
        type,
        title,
        timeMs,
        time: formatTimeOfDay(timeMs, timezone),
        day: group(date),
        date,
        sleepDate: night.date,
        sleepDurationH: night.durationHours ?? undefined,
        subtitle: 'Apple Health',
      });
    }
  }
  return rows.sort((a, b) => b.timeMs - a.timeMs);
}
function formatLocalDate(at: number, timezone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(at));
  const value = (type: string) => parts.find((part) => part.type === type)!.value;
  return `${value('year')}-${value('month')}-${value('day')}`;
}
