import { groupSleepPeriods, opensFollowingNight } from '@trainingai/shared/health/sleep-night';
import { sleepSchema, type SleepRow } from '../../features/health/data/models.ts';

export type SleepSample = {
  start: number;
  end: number;
  value: number;
  source: string;
  bundle: string;
};
export function appleSleepNights(
  samples: readonly SleepSample[],
  timezone: string,
  now = Date.now(),
): SleepRow[] {
  const valid = samples.filter(
    (row) =>
      Number.isFinite(row.start) &&
      Number.isFinite(row.end) &&
      row.end > row.start &&
      row.end <= now &&
      [1, 2, 3, 4, 5].includes(row.value),
  );
  const intervals: { sleepStart: Date; sleepEnd: Date; durationHours: number }[] = [];
  for (const row of valid.filter((row) => row.value !== 2).sort((a, b) => a.start - b.start)) {
    const previous = intervals[intervals.length - 1];
    if (previous && row.start <= previous.sleepEnd.getTime()) {
      previous.sleepEnd = new Date(Math.max(previous.sleepEnd.getTime(), row.end));
      previous.durationHours =
        (previous.sleepEnd.getTime() - previous.sleepStart.getTime()) / 3_600_000;
    } else {
      intervals.push({
        sleepStart: new Date(row.start),
        sleepEnd: new Date(row.end),
        durationHours: (row.end - row.start) / 3_600_000,
      });
    }
  }
  const { nights } = groupSleepPeriods(intervals, timezone);
  const result: SleepRow[] = [];
  for (const night of nights) {
    const start = night.windows[0].sleepStart.getTime();
    const end = night.windows[night.windows.length - 1].sleepEnd.getTime();
    const rows = valid.filter((row) => row.start < end && row.end > start);
    const sources = [...new Set(rows.map((row) => row.bundle || row.source))].sort((a, b) => {
      const staged = (source: string) =>
        rows
          .filter((row) => (row.bundle || row.source) === source && row.value >= 2)
          .reduce((sum, row) => sum + row.end - row.start, 0);
      return staged(b) - staged(a) || a.localeCompare(b);
    });
    const events = rows
      .flatMap((row) => [
        {
          at: Math.max(start, row.start),
          delta: 1,
          value: row.value,
          source: row.bundle || row.source,
        },
        {
          at: Math.min(end, row.end),
          delta: -1,
          value: row.value,
          source: row.bundle || row.source,
        },
      ])
      .sort((a, b) => a.at - b.at);
    const active = new Map<string, Map<number, number>>();
    const durations = [0, 0, 0, 0, 0, 0];
    const bins = Array.from(
      { length: Math.ceil((end - start) / 300_000) },
      () => new Map<string, number>(),
    );
    let index = 0;
    while (index < events.length) {
      const at = events[index].at;
      while (index < events.length && events[index].at === at) {
        const event = events[index++];
        const counts = active.get(event.source) ?? new Map<number, number>();
        counts.set(event.value, (counts.get(event.value) ?? 0) + event.delta);
        active.set(event.source, counts);
      }
      const next = events[index]?.at ?? end;
      const source = sources.find((key) =>
        [...(active.get(key)?.values() ?? [])].some((count) => count > 0),
      );
      const value = [2, 4, 5, 3, 1].find(
        (key) => source && (active.get(source)?.get(key) ?? 0) > 0,
      );
      if (value !== undefined) {
        durations[value] += Math.max(0, next - at);
        const code =
          ({ 2: '4', 3: '2', 4: '1', 5: '3' } as Record<number, string>)[value] ?? '0';
        for (
          let bin = Math.floor((at - start) / 300_000);
          bin < bins.length && start + bin * 300_000 < next;
          bin++
        ) {
          const covered = Math.max(
            0,
            Math.min(next, start + (bin + 1) * 300_000) - Math.max(at, start + bin * 300_000),
          );
          bins[bin].set(code, (bins[bin].get(code) ?? 0) + covered);
        }
      }
    }
    const asleep = durations[1] + durations[3] + durations[4] + durations[5];
    if (
      asleep <= 0 ||
      opensFollowingNight(
        { date: night.date, sleepStart: new Date(start), sleepEnd: new Date(end) },
        timezone,
      )
    ) {
      continue;
    }
    const staged = durations[3] + durations[4] + durations[5];
    const measuredStages = staged / asleep >= 0.95;
    const hours = (value: number) => value / 3_600_000;
    result.push(
      sleepSchema.parse({
        id: `apple-health:${night.date}:${start}`,
        date: night.date,
        sleepStart: new Date(start).toISOString(),
        sleepEnd: new Date(end).toISOString(),
        durationHours: hours(asleep),
        deepSleepHours: measuredStages || durations[4] > 0 ? hours(durations[4]) : null,
        remSleepHours: measuredStages || durations[5] > 0 ? hours(durations[5]) : null,
        lightSleepHours: measuredStages || durations[3] > 0 ? hours(durations[3]) : null,
        awakHours: durations[2] > 0 ? hours(durations[2]) : null,
        manualEntry: false,
        provisional: end > now - 15 * 60_000,
        localOnly: true,
        sourceLabel: 'Apple Health',
        stageCoverage: staged / asleep,
        sleepPhase5Min:
          staged > 0
            ? bins.map((bin) => [...bin].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '0').join('')
            : null,
        phaseWindowStart: new Date(start).toISOString(),
        phaseWindowEnd: new Date(end).toISOString(),
        sources: [
          ...new Map(
            rows.map((row) => [
              row.bundle || row.source,
              { name: row.source, bundleIdentifier: row.bundle },
            ]),
          ).values(),
        ],
      }),
    );
  }
  return result
    .sort(
      (a, b) => b.date.localeCompare(a.date) || (b.durationHours ?? 0) - (a.durationHours ?? 0),
    )
    .filter((row, index, all) => all.findIndex((other) => other.date === row.date) === index);
}
export function mergeAppleSleep(server: readonly SleepRow[], local: readonly SleepRow[]) {
  const days = new Map(server.map((row) => [row.date, row]));
  for (const row of local) {
    const saved = days.get(row.date);
    if (!saved || saved.durationHours === null || saved.manualEntry) {
      days.set(row.date, row);
    }
  }
  return [...days.values()].sort((a, b) => b.date.localeCompare(a.date));
}
