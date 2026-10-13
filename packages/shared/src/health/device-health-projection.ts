import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';
import { shiftDateStr } from '../date-utils';
import { sleepSampleNights } from './sleep-samples';
import { selectNonOverlapping } from './interval-overlap';
export type HealthInterval = {
  id: string;
  kind:
    | 'sleep'
    | 'heartRate'
    | 'restingHeartRate'
    | 'steps'
    | 'activeEnergy'
    | 'weight'
    | 'hrvSdnn'
    | 'hrvRmssd';
  start: string;
  end: string;
  value: number;
  sourceId: string;
  sourceName: string;
  deviceName?: string | null;
  deviceModel?: string | null;
};

export function projectDeviceHealth(
  samples: readonly HealthInterval[],
  timezone: string,
  now = Date.now(),
  sourceLabel = 'Apple Health',
) {
  const rows = samples.filter((row) => Date.parse(row.end) <= now);
  const date = (at: string | number) => formatInTimeZone(new Date(at), timezone, 'yyyy-MM-dd');
  const days = new Map<
    string,
    {
      date: string;
      weightKg?: number;
      restingHeartRate?: number;
      steps?: number;
      activeCalories?: number;
      hrvMs?: number;
    }
  >();
  const day = (key: string) => {
    if (!days.has(key)) {
      days.set(key, { date: key });
    }
    return days.get(key)!;
  };
  for (const type of ['weight', 'restingHeartRate'] as const) {
    for (const row of rows
      .filter((row) => row.kind === type)
      .sort((a, b) => Date.parse(a.end) - Date.parse(b.end) || a.id.localeCompare(b.id))) {
      if (row.value > 0) {
        day(date(row.end))[type === 'weight' ? 'weightKg' : 'restingHeartRate'] =
          type === 'weight' ? row.value : Math.round(row.value);
      }
    }
  }
  for (const [type, key] of [
    ['steps', 'steps'],
    ['activeEnergy', 'activeCalories'],
  ] as const) {
    const groups = new Map<string, HealthInterval[]>();
    for (const row of rows.filter((row) => row.kind === type)) {
      const source = `${row.sourceId}:${row.deviceName ?? ''}:${row.deviceModel ?? ''}`;
      if (!groups.has(source)) {
        groups.set(source, []);
      }
      groups.get(source)!.push(row);
    }
    const totals = new Map<string, number[]>();
    for (const group of groups.values()) {
      const sourceDays = new Map<string, number>();
      const windows = selectNonOverlapping(
        group.map((row) => ({
          startMs: Date.parse(row.start),
          endMs: Date.parse(row.end),
          steps: row.value,
        })),
        (window) => window.steps,
      );
      for (const window of windows) {
        const row = {
          start: new Date(window.startMs).toISOString(),
          end: new Date(window.endMs).toISOString(),
          value: window.steps,
        };
        let start = Date.parse(row.start);
        const end = Date.parse(row.end);
        if (start === end) {
          const key = date(end);
          sourceDays.set(key, (sourceDays.get(key) ?? 0) + row.value);
          continue;
        }
        while (start < end) {
          const key = date(start);
          const boundary = Math.min(
            end,
            fromZonedTime(`${shiftDateStr(key, 1)}T00:00:00`, timezone).getTime(),
          );
          if (boundary <= start) {
            throw new Error('Invalid reporting day');
          }
          const value = (row.value * (boundary - start)) / (end - Date.parse(row.start));
          sourceDays.set(key, (sourceDays.get(key) ?? 0) + value);
          start = boundary;
        }
      }
      for (const [key, value] of sourceDays) {
        if (!totals.has(key)) {
          totals.set(key, []);
        }
        totals.get(key)!.push(value);
      }
    }
    for (const [date, values] of totals) {
      day(date)[key] = Math.round(Math.max(...values));
    }
  }
  const sleep = sleepSampleNights(
    rows
      .filter((row) => row.kind === 'sleep')
      .map((row) => ({
        start: Date.parse(row.start),
        end: Date.parse(row.end),
        value: row.value,
        source: row.sourceName,
        bundle: row.sourceId,
      })),
    timezone,
    now,
    sourceLabel,
  );
  const heart = [
    ...new Map(
      rows
        .filter((row) => row.kind === 'heartRate' && row.value >= 20)
        .sort((a, b) => a.sourceId.localeCompare(b.sourceId))
        .map((row) => [
          row.start,
          { timestamp: new Date(row.start), bpm: Math.round(row.value) },
        ]),
    ).values(),
  ];
  const latestHrv = rows
    .filter((row) => row.kind === 'hrvSdnn' || row.kind === 'hrvRmssd')
    .sort((a, b) => Date.parse(b.end) - Date.parse(a.end))[0];
  const rmssd = new Map<string, Map<string, number[]>>();
  for (const row of rows.filter((row) => row.kind === 'hrvRmssd' && row.value > 0)) {
    const at = Date.parse(row.end);
    const night = sleep.find(
      (night) =>
        at >= Date.parse(night.sleepStart) &&
        at <= Date.parse(night.sleepEnd) &&
        night.sources.some((source) => source.bundleIdentifier === row.sourceId),
    );
    if (!night) continue;
    const key = night.date;
    if (!rmssd.has(key)) rmssd.set(key, new Map());
    const sources = rmssd.get(key)!;
    if (!sources.has(row.sourceId)) sources.set(row.sourceId, []);
    sources.get(row.sourceId)!.push(row.value);
  }
  for (const [key, sources] of rmssd) {
    const values = [...sources].sort(
      (a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]),
    )[0][1];
    day(key).hrvMs = values.reduce((sum, value) => sum + value, 0) / values.length;
  }
  return {
    daily: [...days.values()],
    sleep,
    heart,
    hrv: latestHrv
      ? {
          method: latestHrv.kind === 'hrvSdnn' ? ('SDNN' as const) : ('RMSSD' as const),
          value: latestHrv.value,
          at: latestHrv.end,
          source: latestHrv.sourceName,
        }
      : null,
  };
}
