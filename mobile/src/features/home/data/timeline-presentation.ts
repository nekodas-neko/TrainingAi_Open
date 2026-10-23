import { formatHoursMinutes } from '@trainingai/shared/format/units';
import { formatTimeOfDay, shiftDateStr } from '@trainingai/shared/date-utils';
import type { SleepRow } from '../../health/data/models.ts';
import type { TimelineEvent } from './timeline.ts';
import type { IconName } from '../../../shared/ui/Icon.tsx';

const SAVED_LOCALLY = 'Saved on this phone';

export function isSleepEvent(event: TimelineEvent) {
  return ['wakeup', 'sleep', 'bedtime'].includes(event.type);
}

export function timelineTitle(event: TimelineEvent) {
  if (event.type !== 'meal') return event.title;
  return (
    event.title.replace(/^[\u{1F000}-\u{1FAFF}\u2600-\u27BF\uFE0F\u200D]+\s*/u, '') ||
    event.title
  );
}

export function timelineMetrics(event: TimelineEvent, compact = false) {
  const values: { label: string; value: string }[] = [];
  const bedtime = ['sleep', 'bedtime'].includes(event.type);
  if (event.durationMin != null && (!compact || !bedtime))
    values.push({ label: 'Duration', value: formatHoursMinutes(event.durationMin) });
  if (event.sets != null) values.push({ label: 'Sets', value: event.sets.toLocaleString() });
  if (event.exerciseCount != null)
    values.push({ label: 'Exercises', value: event.exerciseCount.toLocaleString() });
  if (event.distanceKm != null)
    values.push({ label: 'Distance', value: `${event.distanceKm.toFixed(2)} km` });
  if (event.calories != null)
    values.push({
      label: 'Calories',
      value: `${Math.round(event.calories).toLocaleString()} kcal`,
    });
  if (event.sleepDurationH != null && (!compact || !bedtime)) {
    values.push({ label: 'Time asleep', value: formatHoursMinutes(event.sleepDurationH * 60) });
  }
  if ((!compact || event.type === 'wakeup') && event.readinessScore != null)
    values.push({ label: 'Readiness', value: String(event.readinessScore) });
  if ((!compact || event.type === 'wakeup') && event.sleepScore != null)
    values.push({ label: 'Sleep score', value: String(event.sleepScore) });
  if (!compact && event.latencyMin != null)
    values.push({ label: 'Time to fall asleep', value: formatHoursMinutes(event.latencyMin) });
  return values;
}

/** The line above a row, as the current app prints it: "7:00 am – 8:00 am" for a span, else the start. */
export function timelineTimeLabel(event: TimelineEvent, timezone: string) {
  const start = formatTimeOfDay(event.timeMs, timezone);
  return event.endTime && event.type !== 'wakeup' ? `${start} – ${event.endTime}` : start;
}

export function timelineSleepNight(event: TimelineEvent, nights: readonly SleepRow[]) {
  if (!isSleepEvent(event)) return undefined;
  return (
    nights.find((night) => event.sleepDate && night.date === event.sleepDate) ??
    nights.find(
      (night) =>
        night.sleepStart &&
        night.sleepEnd &&
        event.timeMs >= Date.parse(night.sleepStart) &&
        event.timeMs <= Date.parse(night.sleepEnd),
    )
  );
}

export function timelineDestinationDate(
  event: TimelineEvent,
  today: string,
  nights: readonly SleepRow[],
) {
  const date = event.date ?? (event.day === 'today' ? today : shiftDateStr(today, -1));
  return isSleepEvent(event)
    ? (event.sleepDate ?? timelineSleepNight(event, nights)?.date ?? date)
    : date;
}

export type TimelineCardMetric = {
  icon?: IconName;
  /** Which colour the icon takes: the current app tints the readiness bolt and the sleep moon. */
  iconTone?: 'success' | 'sleep';
  text: string;
  /** The score figures print in the foreground colour, the rest muted. */
  emphasis?: boolean;
};

export type TimelineCardContent = {
  title: string;
  /** The wake-up card prints its time bold beside the title instead of on a line above. */
  titleTime: boolean;
  /** Meal, sleep and tag cards space their lines 6 px apart; the others 8 px (space-y-1.5 vs space-y-2). */
  tight: boolean;
  metrics: TimelineCardMetric[];
};

const plural = (count: number, one: string, many: string) =>
  `${count.toLocaleString()} ${count === 1 ? one : many}`;

/**
 * What one timeline event's card says, per type, as components/home-day-timeline.tsx draws it:
 * WakeupCard, WorkoutCard, WalkCard, MealCard, SleepCard, BedtimeCard and TagCard. Durations keep
 * the shared "1h 03m" form (docs/module-map.md makes `formatHoursMinutes` the one duration
 * format; the current app's workout and walk cards use it too).
 */
export function timelineCardContent(event: TimelineEvent): TimelineCardContent {
  const metrics: TimelineCardMetric[] = [];
  const subtitle = event.subtitle && event.subtitle !== SAVED_LOCALLY ? event.subtitle : null;
  let title = timelineTitle(event);
  const duration = () => {
    if (event.durationMin != null)
      metrics.push({ icon: 'history', text: formatHoursMinutes(event.durationMin) });
  };
  switch (event.type) {
    case 'wakeup':
      if (event.sleepDurationH != null)
        metrics.push({ icon: 'bedDouble', text: formatHoursMinutes(event.sleepDurationH * 60) });
      if (event.readinessScore != null)
        metrics.push({
          icon: 'power',
          iconTone: 'success',
          text: String(event.readinessScore),
          emphasis: true,
        });
      if (event.sleepScore != null)
        metrics.push({
          icon: 'moon',
          iconTone: 'sleep',
          text: String(event.sleepScore),
          emphasis: true,
        });
      break;
    case 'workout':
      duration();
      if (event.sets != null)
        metrics.push({ icon: 'workout', text: plural(event.sets, 'set', 'sets') });
      if (event.exerciseCount != null)
        metrics.push({ text: plural(event.exerciseCount, 'exercise', 'exercises') });
      break;
    case 'meal': {
      const parts = subtitle?.split(' · ') ?? [];
      const calories =
        parts.length === 2
          ? parts[0]
          : event.calories != null
            ? `${Math.round(event.calories).toLocaleString()} kcal`
            : null;
      const window = parts.length === 2 ? parts[1] : parts[0];
      if (calories) metrics.push({ icon: 'flame', text: calories });
      if (window) metrics.push({ text: window });
      break;
    }
    case 'sleep':
      if (subtitle) metrics.push({ icon: 'history', text: subtitle });
      break;
    case 'bedtime':
      break;
    case 'tag':
      if (subtitle) metrics.push({ text: subtitle });
      break;
    default: {
      // walk, cardio and anything logged by hand: the current app's WalkCard.
      title =
        event.title === 'Run'
          ? 'Outdoor running'
          : event.title === 'Walk'
            ? 'Outdoor walking'
            : title;
      // One decimal, and nothing for a zero: a sensor can report 0 km on a stationary workout.
      const km = event.distanceKm == null ? 0 : Math.round(event.distanceKm * 10) / 10;
      if (km > 0) title += ` / ${km} km`;
      duration();
      if (event.calories != null)
        metrics.push({
          icon: 'flame',
          text: `${Math.round(event.calories).toLocaleString()} kcal`,
        });
      if (subtitle) metrics.push({ text: subtitle });
    }
  }
  return {
    title,
    titleTime: event.type === 'wakeup',
    tight: ['meal', 'sleep', 'tag'].includes(event.type),
    metrics,
  };
}
