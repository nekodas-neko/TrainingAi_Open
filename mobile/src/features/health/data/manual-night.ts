import { shiftDateStr, isCalendarDate } from '@trainingai/shared/date-utils';

function clockMinutes(clock: string) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(clock.trim());
  if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) {
    return null;
  }
  return Number(match[1]) * 60 + Number(match[2]);
}
function clockInstant(day: string, minute: number, timezone: string) {
  const [year, month, dayNumber] = day.split('-').map(Number);
  const target = Date.UTC(year, month - 1, dayNumber, Math.floor(minute / 60), minute % 60);
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  let at = target;
  for (let attempt = 0; attempt < 4; attempt++) {
    const parts = formatter.formatToParts(at);
    const part = (type: Intl.DateTimeFormatPartTypes) =>
      Number(parts.find((p) => p.type === type)?.value);
    const wall = Date.UTC(
      part('year'),
      part('month') - 1,
      part('day'),
      part('hour'),
      part('minute'),
    );
    if (wall === target) {
      return new Date(at).toISOString();
    }
    at += target - wall;
  }
  return null;
}
export function bedtimeInstant(date: string, bed: string, timezone: string) {
  const minutes = clockMinutes(bed);
  if (minutes === null || !isCalendarDate(date)) {
    return null;
  }
  return clockInstant(minutes >= 720 ? shiftDateStr(date, -1) : date, minutes, timezone);
}
export function dayTimeInstant(date: string, clock: string, timezone: string) {
  const match = /^(\d{2}:\d{2})(?::(\d{2}))?$/.exec(clock);
  if (!match || !isCalendarDate(date)) {
    return null;
  }
  const minutes = clockMinutes(match[1]);
  const seconds = Number(match[2] ?? 0);
  if (minutes === null || seconds > 59) {
    return null;
  }
  const at = clockInstant(date, minutes, timezone);
  return at ? new Date(Date.parse(at) + seconds * 1000).toISOString() : null;
}
export function manualNightWindow(date: string, bed: string, wake: string, timezone: string) {
  const sleepStart = bedtimeInstant(date, bed, timezone);
  const end = clockMinutes(wake);
  if (!sleepStart || end === null) {
    return null;
  }
  const sleepEnd = clockInstant(date, end, timezone);
  return sleepStart && sleepEnd ? { sleepStart, sleepEnd } : null;
}
