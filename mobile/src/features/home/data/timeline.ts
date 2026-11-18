import { z } from 'zod';
import { formatTimeOfDay, shiftDateStr } from '@trainingai/shared/date-utils';
import { doseTimelineText, isMilligramDosed } from '@trainingai/shared/nutrition/vial-plan';
import { activeElapsedMs, type WorkoutRecord } from '../../workouts/logging/workout.ts';
import { sleepWokeEnd } from '../../health/data/body-view.ts';
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
    // #2185: a dose row's supplement and the day it was logged against.
    supplementId: z.string().optional(),
    logDate: z.string().optional(),
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
  /** The phone's health store a `localOnly` night came from: `deviceHealthName` (#3669 item 3). */
  deviceSource: string,
) {
  // #3426: the server's "Woke up" is the session's recorded window end. Show the time that night's
  // sleep ended, as the night header and Home do (#3415). The night is the one whose recorded end
  // the event carries, so a nap on the same day is never picked.
  const rows = events.map((row) => {
    if (row.type !== 'wakeup') return row;
    const night = sleep.find((n) => n.sleepEnd != null && Date.parse(n.sleepEnd) === row.timeMs);
    const woke = night ? sleepWokeEnd(night) : null;
    const timeMs = woke ? Date.parse(woke) : NaN;
    return Number.isFinite(timeMs) && timeMs !== row.timeMs
      ? { ...row, timeMs, time: formatTimeOfDay(timeMs, timezone) }
      : row;
  });
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
          : Math.round(activeElapsedMs(workout, workout.completedAt) / 60_000),
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
      ['wakeup', 'Woke up', sleepWokeEnd(night)],
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
        subtitle: deviceSource,
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
/** The part of a queued supplement tick the dose overlay reads (#2185). */
export type DoseOperation = {
  domain: string;
  date: string;
  payload: Record<string, unknown>;
};
/** The part of today's local supplement log the dose overlay reads (#3863). */
export type LocalDose = {
  id: string;
  loggedToday?: boolean;
  loggedDose?: { amount?: number | null; unit?: string | null; takenAt?: string | null } | null;
};
/**
 * #2185 option A. A dose ticked on this phone and not yet synced is on the timeline at once, and
 * an unsynced un-tick takes the server's row away; the latest queued change per supplement and day
 * wins. A local row has no vial facts (the vial list is the server's), so it shows the title alone.
 * Milligram-dosed only, as the route decides it.
 *
 * #3863: today's local supplement log is the base, so a dose stays once its upload is confirmed and
 * leaves the outbox, while the timeline refetch is pending or the phone is offline. Queued changes
 * still apply on top of it.
 */
export function withLocalDoses(
  events: readonly TimelineEvent[],
  operations: readonly DoseOperation[],
  today: string,
  timezone: string,
  logged: readonly LocalDose[] = [],
) {
  const yesterday = shiftDateStr(today, -1);
  const base: DoseOperation[] = logged.flatMap((s) =>
    s.loggedToday && s.loggedDose
      ? [
          {
            domain: 'supplement_logs',
            date: today,
            payload: { supplementId: s.id, logDate: today, ...s.loggedDose, local: true },
          },
        ]
      : [],
  );
  const latest = new Map<string, DoseOperation>();
  for (const op of [...base, ...operations]) {
    const id = op.payload.supplementId;
    if (op.domain !== 'supplement_logs' || typeof id !== 'string') continue;
    if (op.date !== today && op.date !== yesterday) continue;
    latest.set(id + ':' + op.date, op);
  }
  let rows = events.slice();
  for (const op of latest.values()) {
    const p = op.payload;
    const supplementId = p.supplementId as string;
    const isThis = (row: TimelineEvent) =>
      row.type === 'dose' &&
      row.supplementId === supplementId &&
      (typeof row.logDate === 'string' ? row.logDate : row.date) === op.date;
    const amount = typeof p.amount === 'number' && Number.isFinite(p.amount) ? p.amount : null;
    const unit = typeof p.unit === 'string' ? p.unit : null;
    const timeMs = typeof p.takenAt === 'string' ? Date.parse(p.takenAt) : NaN;
    const dose =
      !p.deleted && amount != null && isMilligramDosed({ unit }) && Number.isFinite(timeMs);
    // The server already has this very tick: keep its row, which carries the vial line. For the
    // settled local log, any server row for that supplement and day is the same dose.
    if (dose && rows.some((row) => isThis(row) && (p.local === true || row.timeMs === timeMs)))
      continue;
    rows = rows.filter((row) => !isThis(row));
    if (!dose) continue;
    const date = formatLocalDate(timeMs, timezone);
    if (date !== today && date !== yesterday) continue;
    rows.push({
      type: 'dose',
      title: doseTimelineText({ amount, unit }, null).title,
      timeMs,
      time: formatTimeOfDay(timeMs, timezone),
      day: date === today ? 'today' : 'yesterday',
      date,
      supplementId,
      logDate: op.date,
      // A settled local dose is already on the server; only a queued one is phone-only.
      ...(p.local === true ? {} : { subtitle: 'Saved on this phone' }),
    });
  }
  return rows.sort((a, b) => b.timeMs - a.timeMs);
}
