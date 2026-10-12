import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';
import { shiftDateStr } from '../date-utils';
import { appleSleepNights } from './apple-sleep';
import { selectNonOverlapping } from './interval-overlap';
import type { AppleSample } from '../validation/apple-health-import';

export function projectAppleHealth(
  samples: readonly AppleSample[],
  timezone: string,
  now = Date.now(),
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
    }
  >();
  const day = (key: string) => {
    if (!days.has(key)) {
      days.set(key, { date: key });
    }
    return days.get(key)!;
  };
  for (const type of [
    'HKQuantityTypeIdentifierBodyMass',
    'HKQuantityTypeIdentifierRestingHeartRate',
  ] as const) {
    for (const row of rows
      .filter((row) => row.type === type)
      .sort((a, b) => Date.parse(a.end) - Date.parse(b.end) || a.id.localeCompare(b.id))) {
      if (row.value > 0) {
        day(date(row.end))[
          type === 'HKQuantityTypeIdentifierBodyMass' ? 'weightKg' : 'restingHeartRate'
        ] = type === 'HKQuantityTypeIdentifierBodyMass' ? row.value : Math.round(row.value);
      }
    }
  }
  for (const [type, key] of [
    ['HKQuantityTypeIdentifierStepCount', 'steps'],
    ['HKQuantityTypeIdentifierActiveEnergyBurned', 'activeCalories'],
  ] as const) {
    const groups = new Map<string, AppleSample[]>();
    for (const row of rows.filter((row) => row.type === type)) {
      const source = `${row.sourceBundleId}:${row.deviceName ?? ''}:${row.deviceModel ?? ''}`;
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
        })),(window)=>window.steps,
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
  const sleep = appleSleepNights(
    rows
      .filter((row) => row.type === 'HKCategoryTypeIdentifierSleepAnalysis')
      .map((row) => ({
        start: Date.parse(row.start),
        end: Date.parse(row.end),
        value: row.value,
        source: row.sourceName,
        bundle: row.sourceBundleId,
      })),
    timezone,
    now,
  );
  const heart = [
    ...new Map(
      rows
        .filter((row) => row.type === 'HKQuantityTypeIdentifierHeartRate' && row.value >= 20)
        .sort((a, b) => a.sourceBundleId.localeCompare(b.sourceBundleId))
        .map((row) => [row.start, { timestamp: new Date(row.start), bpm: Math.round(row.value) }]),
    ).values(),
  ];
  const latestSdnn = rows
    .filter((row) => row.type === 'HKQuantityTypeIdentifierHeartRateVariabilitySDNN')
    .sort((a, b) => Date.parse(b.end) - Date.parse(a.end))[0];
  return {
    daily: [...days.values()],
    sleep,
    heart,
    hrv: latestSdnn
      ? {
          method: 'SDNN' as const,
          value: latestSdnn.value,
          at: latestSdnn.end,
          source: latestSdnn.sourceName,
        }
      : null,
  };
}
