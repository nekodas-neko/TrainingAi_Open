import { recordsSleep } from '@trainingai/shared/health/sleep-night';
import type { LocalSleepSession } from '@/lib/local-store/types';

export type SleepRow = {
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
  sleepScore: number | null;
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
};

// Contiguity threshold for treating two same-date rows as one sleep period. Midnight-split
// halves (Samsung) are adjacent (gap ≈ 0); evening wind-down, afternoon naps, and stray BLE
// daytime windows sit hours away from the night. 1h keeps splits together and drops naps.
const CONTIGUOUS_GAP_MS = 60 * 60 * 1000;

// Reduce a date's rows to just the main sleep period: the longest row plus any row temporally
// contiguous with the growing window. Distant short fragments are dropped so they can't drag the
// night's bedtime earlier or its wake-time later (the "7:40 pm bedtime" / "2:59 pm wake" bugs —
// a 20-min evening rest or afternoon nap Oura/BLE recorded as its own session got unioned in).
function primaryCluster(list: SleepRow[]): SleepRow[] {
  const timed = list.filter(r => r.sleepStart && r.sleepEnd);
  if (timed.length <= 1) return list;
  const span = (r: SleepRow) => new Date(r.sleepEnd!).getTime() - new Date(r.sleepStart!).getTime();
  const longest = timed.reduce((a, b) => ((b.durationHours ?? span(b)) > (a.durationHours ?? span(a)) ? b : a));
  let start = new Date(longest.sleepStart!).getTime();
  let end = new Date(longest.sleepEnd!).getTime();
  const kept = new Set<SleepRow>([longest]);
  for (let changed = true; changed; ) {
    changed = false;
    for (const r of timed) {
      if (kept.has(r)) continue;
      const s = new Date(r.sleepStart!).getTime(), e = new Date(r.sleepEnd!).getTime();
      if (s <= end + CONTIGUOUS_GAP_MS && e >= start - CONTIGUOUS_GAP_MS) {
        kept.add(r); start = Math.min(start, s); end = Math.max(end, e); changed = true;
      }
    }
  }
  // Rows without timestamps can't be placed, so keep them (existing merge handles them).
  return list.filter(r => kept.has(r) || !r.sleepStart || !r.sleepEnd);
}

// Merge same-date sleep rows (Samsung Health splits midnight sessions).
// When exactly one of the rows has an ouraId, the Oura row is authoritative
// for all duration fields (Oura reports sleep onset, not in-bed time) and the
// Samsung row only contributes the earliest start / latest end timestamps.
export function mergeByDate(rows: SleepRow[]) {
  const byDate = new Map<string, SleepRow[]>();
  // Q-274: `primaryCluster` picks the LONGEST row, so on a date carrying a nap plus the night the
  // night already wins. What it cannot fix is a date whose ONLY row is a fragment: with one row it
  // returns early, and production has a date (2026-08-22) whose sole row is 0.00 h — which the
  // sleep list rendered as a night of zero hours. A zero-duration row is a bed period the recorder
  // never resolved into sleep, not a short night, and `computeSleepScore` already returns null for
  // it. Showing nothing for that date is honest; showing 0.00 h reads as "you slept none".
  //
  // The predicate is imported rather than rewritten: `sleep-night.ts` is where "does this row
  // record any sleep" is decided, and a second copy here is how the two drift.
  for (const r of rows.filter(r => recordsSleep(r.durationHours))) {
    const list = byDate.get(r.date) ?? [];
    list.push(r);
    byDate.set(r.date, list);
  }

  const results: SleepRow[] = [];
  for (const rawList of byDate.values()) {
    const list = primaryCluster(rawList);
    if (list.length === 1) { results.push(list[0]); continue; }

    const ouraRows   = list.filter(r => r.ouraId != null);
    const samsungRows = list.filter(r => r.ouraId == null);

    // Mixed sources: Oura row is authoritative for duration/quality fields.
    if (ouraRows.length === 1 && samsungRows.length >= 1) {
      const authoritative = { ...ouraRows[0] };
      // The phase string belongs to the Oura row alone — record its own bedtime
      // window before extending sleepStart/sleepEnd to cover Samsung's wider
      // in-bed time, so a hypnogram can position itself against the window its
      // data actually spans rather than the (possibly wider) merged display window.
      authoritative.phaseWindowStart = ouraRows[0].sleepStart;
      authoritative.phaseWindowEnd = ouraRows[0].sleepEnd;
      // Extend start/end to cover all rows (in-bed time from Samsung)
      for (const r of samsungRows) {
        if (r.sleepStart && (!authoritative.sleepStart || r.sleepStart < authoritative.sleepStart)) {
          authoritative.sleepStart = r.sleepStart;
        }
        if (r.sleepEnd && (!authoritative.sleepEnd || r.sleepEnd > authoritative.sleepEnd)) {
          authoritative.sleepEnd = r.sleepEnd;
        }
      }
      results.push(authoritative);
      continue;
    }

    // Same source (multiple Samsung splits or multiple Oura sessions): additive merge
    const merged = {
      ...list[0],
      phaseWindowStart: list[0].sleepPhase5Min ? list[0].sleepStart : null,
      phaseWindowEnd:   list[0].sleepPhase5Min ? list[0].sleepEnd   : null,
    };
    const add = (a: number | null, b: number | null) =>
      a != null && b != null ? +(a + b).toFixed(2) : (a ?? b);
    for (const r of list.slice(1)) {
      merged.durationHours   = add(merged.durationHours,   r.durationHours);
      merged.deepSleepHours  = add(merged.deepSleepHours,  r.deepSleepHours);
      merged.remSleepHours   = add(merged.remSleepHours,   r.remSleepHours);
      merged.lightSleepHours = add(merged.lightSleepHours, r.lightSleepHours);
      merged.awakHours       = add(merged.awakHours,       r.awakHours);
      merged.efficiency      = merged.efficiency      ?? r.efficiency;
      merged.onsetLatencySec = merged.onsetLatencySec ?? r.onsetLatencySec;
      merged.averageHrvMs    = merged.averageHrvMs    ?? r.averageHrvMs;
      merged.avgHeartRate    = merged.avgHeartRate    ?? r.avgHeartRate;
      merged.lowestHeartRate = merged.lowestHeartRate ?? r.lowestHeartRate;
      merged.restlessPeriods = merged.restlessPeriods ?? r.restlessPeriods;
      merged.sleepScore      = merged.sleepScore      ?? r.sleepScore;
      merged.respiratoryRate = merged.respiratoryRate ?? r.respiratoryRate;
      // Track which row's phase string ends up kept, so the ribbon can be
      // positioned against that row's own bedtime window (see above).
      if (!merged.sleepPhase5Min && r.sleepPhase5Min) {
        merged.phaseWindowStart = r.sleepStart;
        merged.phaseWindowEnd = r.sleepEnd;
      }
      merged.sleepPhase5Min  = merged.sleepPhase5Min  ?? r.sleepPhase5Min;
      if (r.sleepStart && (!merged.sleepStart || r.sleepStart < merged.sleepStart)) {
        merged.sleepStart = r.sleepStart;
      }
      if (r.sleepEnd && (!merged.sleepEnd || r.sleepEnd > merged.sleepEnd)) {
        merged.sleepEnd = r.sleepEnd;
      }
    }
    results.push(merged);
  }
  return results;
}

/**
 * #2414 — the local store's sleep rows in the shape `/api/sleep-sessions` returns: one row per
 * night, newest first. The cold-open seed for every screen that reads that route.
 *
 * **A date is merged only when every row on it carries its window.** `mergeByDate` is the route's
 * own formula and is right for timed rows: `primaryCluster` drops naps and evening fragments, so
 * only contiguous splits reach the additive merge. Untimed rows defeat that — clustering returns
 * early and the additive merge SUMS a night and its naps into a fabricated 11.5 h night (BF-115's
 * refutation). Rows pulled before SQLite v50 have no window, so a date holding any such row passes
 * through raw, exactly as the seed always passed it.
 *
 * Newest first because the route is and every reader assumes it (`sleepRows[0]` is "last night");
 * the store returns oldest first. `sleepTimeRecommendation` and `provisional` are not in the local
 * table — null/absent, which every reader already treats as "cannot tell".
 */
export function localSleepRowsAsNights(local: readonly LocalSleepSession[]): SleepRow[] {
  const byDate = new Map<string, SleepRow[]>();
  for (const l of local) {
    const row: SleepRow = {
      date: l.date, ouraId: l.ouraId,
      durationHours: l.durationHours, deepSleepHours: l.deepSleepHours,
      remSleepHours: l.remSleepHours, lightSleepHours: l.lightSleepHours, awakHours: l.awakHours,
      efficiency: l.efficiency, onsetLatencySec: l.onsetLatencySec, averageHrvMs: l.averageHrvMs,
      avgHeartRate: l.avgHeartRate, lowestHeartRate: l.lowestHeartRate,
      restlessPeriods: l.restlessPeriods, sleepScore: l.sleepScore,
      respiratoryRate: l.respiratoryRate, sleepPhase5Min: l.sleepPhase5Min,
      sleepStart: l.sleepStart, sleepEnd: l.sleepEnd,
      sleepTimeRecommendation: null,
      manualSleepStart: l.manualSleepStart,
      manualEntry: l.manualEntry,
    };
    const list = byDate.get(row.date) ?? [];
    list.push(row);
    byDate.set(row.date, list);
  }
  const out: SleepRow[] = [];
  for (const list of byDate.values()) {
    out.push(...(list.every(r => r.sleepStart && r.sleepEnd) ? mergeByDate(list) : list));
  }
  // Array.prototype.sort is stable, so rows sharing an untimed date keep the store's order.
  return out.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}
