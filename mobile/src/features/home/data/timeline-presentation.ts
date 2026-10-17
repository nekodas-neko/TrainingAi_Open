import { formatHoursMinutes } from '@trainingai/shared/format/units';
import { shiftDateStr } from '@trainingai/shared/date-utils';
import type { SleepRow } from '../../health/data/models.ts';
import type { TimelineEvent } from './timeline.ts';

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

export function timelineSummary(event: TimelineEvent) {
  const values = timelineMetrics(event, true).map((metric) =>
    metric.label === 'Readiness'
      ? `Readiness ${metric.value}`
      : metric.label === 'Sleep score'
        ? `Sleep ${metric.value}`
        : metric.label === 'Sets'
          ? `${metric.value} sets`
          : metric.label === 'Exercises'
            ? `${metric.value} exercises`
            : metric.value,
  );
  if (event.endTime && event.type !== 'wakeup') values.unshift(`${event.time} – ${event.endTime}`);
  if (event.subtitle && event.subtitle !== 'Saved on this phone') values.push(event.subtitle);
  return values.join(' · ');
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
