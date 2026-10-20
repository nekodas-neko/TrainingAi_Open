import { groupSleepPeriods, aggregateNight, canonicalNightForDate } from '@trainingai/shared/health/sleep-night';
import { DEFAULT_TZ } from '@trainingai/shared/date-utils';
import type { LocalSleepSession } from '@/lib/local-store/types';

export type SleepRow = {
  /** The row id. `removeManualNight` needs it; optional so a payload sent before it existed still parses. */
  id?: string;
  date: string;
  ouraId: string | null;
  durationHours: number | null;
  deepSleepHours: number | null;
  remSleepHours: number | null;
  lightSleepHours: number | null;
  awakHours: number | null;
  efficiency: number | null;
  onsetLatencySec: number | null;
  averageHrvMs: number | null;
  avgHeartRate: number | null;
  lowestHeartRate: number | null;
  restlessPeriods: number | null;
  // No `sleepScore` (#3011): a session's own score could only be Oura's. Ours is `oura_daily_derived`.
  respiratoryRate: number | null;
  sleepPhase5Min: string | null;
  sleepStart: string | null;
  sleepEnd: string | null;
  // The bedtime window the phase string itself actually spans — set during merge
  // when it differs from the (possibly Samsung-widened) display sleepStart/sleepEnd.
  phaseWindowStart?: string | null;
  phaseWindowEnd?: string | null;
  sleepTimeRecommendation: string | null;
  /**
   * The bedtime the user remembers for a night the ring missed the start of (Q-519). Its own field,
   * never folded into `sleepStart`: the measured window stays measured, and the card that edits it
   * reads it back from here. Optional so a payload from before it existed still parses (#2264).
   */
  manualSleepStart?: string | null;
  /**
   * #2338 — the night was entered by hand. Only ever true on a night no device recorded: both
   * repositories drop a manual night a device night covers (`preferDeviceNights`) before this row is
   * built. Optional so a payload from before it existed still parses. Lets a screen say whose night it is.
   */
  manualEntry?: boolean;
  /**
   * #3057 — Oura Cloud's type for the period (`long_sleep`, `sleep`, `late_nap`, or a type Oura
   * added, #3081); null on every other source. `mergeByDate` never folds a non-`long_sleep` period
   * beside a `long_sleep` into the night. The device's store carries it since SQLite v53 (#3060);
   * optional because a row pulled before v53, and a payload from before #3057, has none.
   */
  ouraSleepType?: string | null;
};

/** A row as a window the night grouping can read: its times as instants, the row itself carried along. */
type RowWindow = {
  row: SleepRow
  date: string
  sleepStart: Date
  sleepEnd: Date
  durationHours: number | null
  ouraSleepType: string | null
  deepSleepHours: number | null
  remSleepHours: number | null
  lightSleepHours: number | null
  awakHours: number | null
  efficiency: number | null
  onsetLatencySec: number | null
  averageHrvMs: number | null
  avgHeartRate: number | null
  lowestHeartRate: number | null
  restlessPeriods: number | null
  respiratoryRate: number | null
}

// The night's main period: its longest row by sleep, by window when a row has no duration.
const span = (w: RowWindow) => w.sleepEnd.getTime() - w.sleepStart.getTime()
function mainWindow(list: RowWindow[]): RowWindow {
  return list.reduce((a, b) => ((b.durationHours ?? span(b) / 3_600_000) > (a.durationHours ?? span(a) / 3_600_000) ? b : a))
}

/**
 * The sleep list's nights: for each wake date, the SAME night the Sleep Score scores (#3080).
 *
 * The card used to build its own night: same-date rows within 60 minutes of each other, an Oura row
 * authoritative over a Samsung one, stages summed. The score groups windows within 3 hours across
 * dates (`groupSleepPeriods`), restamps the wake date from the last window's end, and recomputes
 * efficiency, awake time and awakenings over the whole night (`aggregateNight`). On any night with
 * several windows, or one whose stored date disagreed with its local wake day, the card and the score
 * described different nights. Now the card shows the score's aggregate: the canonical night per date
 * (`canonicalNightForDate`), its totals, efficiency, awake time, awakenings and vitals.
 *
 * What stays the card's own: the row identity (`id`, `ouraId`, `manualEntry`, the remembered
 * bedtime) comes from the night's main window, and so does the hypnogram, positioned against that
 * window (`phaseWindowStart`/`phaseWindowEnd`) because a phase string spans only its own period.
 *
 * Naps, zero-duration bed periods and a short evening window that opens the next night are left
 * out, by the same rules the score uses (#3057, Q-274, #2456). An untimed row cannot be placed in a
 * night at all; it is passed through as it was.
 */
export function mergeByDate(rows: SleepRow[], tz: string = DEFAULT_TZ): SleepRow[] {
  const untimed = rows.filter(r => !r.sleepStart || !r.sleepEnd)
  const windows: RowWindow[] = rows.filter(r => r.sleepStart && r.sleepEnd).map(r => ({
    row: r, date: r.date,
    sleepStart: new Date(r.sleepStart!), sleepEnd: new Date(r.sleepEnd!),
    durationHours: r.durationHours, ouraSleepType: r.ouraSleepType ?? null,
    deepSleepHours: r.deepSleepHours, remSleepHours: r.remSleepHours, lightSleepHours: r.lightSleepHours,
    awakHours: r.awakHours, efficiency: r.efficiency, onsetLatencySec: r.onsetLatencySec,
    averageHrvMs: r.averageHrvMs, avgHeartRate: r.avgHeartRate, lowestHeartRate: r.lowestHeartRate,
    restlessPeriods: r.restlessPeriods, respiratoryRate: r.respiratoryRate,
  }))
  const periods = groupSleepPeriods(windows, tz).nights
  const aggregates = periods.map(p => ({ period: p, night: aggregateNight(p) }))
  const byNight = new Map(aggregates.map(a => [a.night, a.period]))
  const nights = aggregates.map(a => a.night)

  const results: SleepRow[] = []
  for (const date of [...new Set(nights.map(n => n.date))]) {
    const night = canonicalNightForDate(nights, date, tz)
    const period = night ? byNight.get(night) : undefined
    if (!night || !period) continue
    const main = mainWindow(period.windows)
    // A one-window night is the row itself (`aggregateNight` changes nothing but the wake date).
    if (period.windows.length === 1) { results.push({ ...main.row, date: night.date }); continue }
    const first = period.windows[0].row
    const last = period.windows[period.windows.length - 1].row
    // Hours are summed in floating point; the card shows them to two places, as it always did.
    const h = (x: number | null | undefined) => (x == null ? null : +x.toFixed(2))
    results.push({
      ...main.row,
      date: night.date,
      sleepStart: first.sleepStart,
      sleepEnd: last.sleepEnd,
      durationHours: h(night.durationHours),
      deepSleepHours: h(night.deepSleepHours),
      remSleepHours: h(night.remSleepHours),
      lightSleepHours: h(night.lightSleepHours),
      awakHours: h(night.awakHours),
      efficiency: night.efficiency ?? null,
      onsetLatencySec: night.onsetLatencySec ?? null,
      averageHrvMs: night.averageHrvMs ?? null,
      avgHeartRate: night.avgHeartRate ?? null,
      lowestHeartRate: night.lowestHeartRate ?? null,
      restlessPeriods: night.restlessPeriods ?? null,
      respiratoryRate: night.respiratoryRate ?? null,
      // The ribbon is the main window's phase string, which spans only that window; say which, so
      // the hypnogram can position itself inside the wider night.
      sleepPhase5Min: main.row.sleepPhase5Min,
      phaseWindowStart: main.row.sleepPhase5Min ? main.row.sleepStart : null,
      phaseWindowEnd: main.row.sleepPhase5Min ? main.row.sleepEnd : null,
    })
  }
  // Newest first, as the route always returned them: every reader takes `[0]` as last night and
  // `slice(0, n)` as the recent nights (#3106 review). Grouping yields them oldest first.
  return [...results.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)), ...untimed]
}

/**
 * #2414 — the local store's sleep rows in the shape `/api/sleep-sessions` returns: one row per
 * night, newest first. The cold-open seed for every screen that reads that route.
 *
 * **A date is merged only when every row on it carries its window.** `mergeByDate` is the route's
 * own formula and is right for timed rows: the night grouping (`groupSleepPeriods`, #3080) leaves naps
 * and evening fragments out and aggregates only a night's own windows. Untimed rows cannot be placed
 * in a night at all, and summing them is what once fabricated an 11.5 h night (BF-115's refutation). Rows pulled before SQLite v50 have no window, so a date holding any such row passes
 * through raw, exactly as the seed always passed it.
 *
 * **Oura's period type rides along (#3060)**, pulled into SQLite v53, so `mergeByDate` keeps a `sleep`
 * fragment beside its `long_sleep` night out of it, as the route does (#3057). A row pulled before v53
 * has no type and reads as "unknown", which joins it as the seed always did, until the server re-sends
 * it. Never guessed from length: a short night Oura typed `long_sleep` and a pre-Cloud Oura row look
 * the same on the device.
 *
 * Newest first because the route is and every reader assumes it (`sleepRows[0]` is "last night");
 * the store returns oldest first. `sleepTimeRecommendation` and `provisional` are not in the local
 * table — null/absent, which every reader already treats as "cannot tell".
 */
export function localSleepRowsAsNights(local: readonly LocalSleepSession[], tz: string = DEFAULT_TZ): SleepRow[] {
  const byDate = new Map<string, SleepRow[]>();
  for (const l of local) {
    const row: SleepRow = {
      id: l.id, date: l.date, ouraId: l.ouraId,
      durationHours: l.durationHours, deepSleepHours: l.deepSleepHours,
      remSleepHours: l.remSleepHours, lightSleepHours: l.lightSleepHours, awakHours: l.awakHours,
      efficiency: l.efficiency, onsetLatencySec: l.onsetLatencySec, averageHrvMs: l.averageHrvMs,
      avgHeartRate: l.avgHeartRate, lowestHeartRate: l.lowestHeartRate,
      restlessPeriods: l.restlessPeriods,
      respiratoryRate: l.respiratoryRate, sleepPhase5Min: l.sleepPhase5Min,
      sleepStart: l.sleepStart, sleepEnd: l.sleepEnd,
      sleepTimeRecommendation: null,
      manualSleepStart: l.manualSleepStart,
      manualEntry: l.manualEntry,
      ouraSleepType: l.ouraSleepType ?? null,
    };
    const list = byDate.get(row.date) ?? [];
    list.push(row);
    byDate.set(row.date, list);
  }
  // Timed dates are grouped together, as the score groups them: a night's windows can carry
  // different stored dates (#3080), so grouping date by date would split it.
  const timed: SleepRow[] = [];
  const out: SleepRow[] = [];
  for (const list of byDate.values()) {
    if (list.every(r => r.sleepStart && r.sleepEnd)) timed.push(...list);
    else out.push(...list);
  }
  out.push(...mergeByDate(timed, tz));
  // Array.prototype.sort is stable, so rows sharing an untimed date keep the store's order.
  return out.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}
