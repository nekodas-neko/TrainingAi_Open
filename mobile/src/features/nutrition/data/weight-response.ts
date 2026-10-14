import {
  daysBetweenDateStrs,
  isCalendarDate,
  shiftDateStr,
  toAestDay,
} from '@trainingai/shared/date-utils';
import { doseDiffers, type DoseLogEntry } from '@trainingai/shared/health/dose-change-caveat';
import {
  computeWeightRateFit,
  type WeightPoint,
} from '@trainingai/shared/health/long-term-goal-progress';
import { iqrBand, median, quantile } from '@trainingai/shared/stats';
export const DEFAULT_BAND_PCT_PER_WEEK = { lo: 0.5, hi: 1.0 };
const SCALE_SD_FLOOR_KG = 0.029;
const MEASURED_RESIDUAL_SD_KG = 1.203;
const FITTED_SD_TRUSTED_AT = 10;
const T95 = [
  Infinity,
  12.71,
  4.303,
  3.182,
  2.776,
  2.571,
  2.447,
  2.365,
  2.306,
  2.262,
  2.228,
  2.201,
  2.179,
  2.16,
  2.145,
  2.131,
  2.12,
  2.11,
  2.101,
  2.093,
  2.086,
  2.08,
  2.074,
  2.069,
  2.064,
  2.06,
  2.056,
  2.052,
  2.048,
  2.045,
  2.042,
];
function t95(df: number): number {
  return df <= 0 ? Infinity : df < T95.length ? T95[df] : 1.96;
}
export type ResponseVerdict = 'too_fast' | 'in_band' | 'too_slow' | 'gaining';
export interface WeightResponse {
  lossKgPerWeek: number;
  loKgPerWeek: number;
  hiKgPerWeek: number;
  weighIns: number;
  spanDays: number;
  bandLoKgPerWeek: number;
  bandHiKgPerWeek: number;
  verdict: ResponseVerdict | null;
}
export interface WeightResponseInput {
  points: WeightPoint[];
  bodyweightKg?: number | null;
  bandPctPerWeek?: {
    lo: number;
    hi: number;
  };
}
function dayVariance(dates: string[]): number | null {
  const xs = dates.map((d) => Date.parse(`${d}T00:00:00Z`) / 86400000);
  if (xs.some((x) => Number.isNaN(x))) return null;
  const mean = xs.reduce((a, x) => a + x, 0) / xs.length;
  const sum = xs.reduce((a, x) => a + (x - mean) ** 2, 0);
  return sum > 0 ? sum : null;
}
export function weightResponse(input: WeightResponseInput): WeightResponse | null {
  const { points, bandPctPerWeek = DEFAULT_BAND_PCT_PER_WEEK } = input;
  const fit = computeWeightRateFit(points);
  if (!fit || fit.stdErrKgPerWeek == null) return null;
  const weighed = points.filter((p) => p.weightKg != null);
  const varX = dayVariance(weighed.map((p) => p.date));
  if (varX == null) return null;
  const sdFitted = (fit.stdErrKgPerWeek * Math.sqrt(varX)) / 7;
  const floor =
    fit.weighIns >= FITTED_SD_TRUSTED_AT ? SCALE_SD_FLOOR_KG : MEASURED_RESIDUAL_SD_KG;
  const sd = Math.max(sdFitted, floor);
  const stdErr = (sd / Math.sqrt(varX)) * 7;
  const half = t95(fit.weighIns - 2) * stdErr;
  if (!Number.isFinite(half)) return null;
  const loss = -fit.rateKgPerWeek;
  const lo = loss - half;
  const hi = loss + half;
  const latest =
    [...weighed].sort((a, b) => a.date.localeCompare(b.date)).at(-1)?.weightKg ?? null;
  const bodyweightKg = input.bodyweightKg ?? latest;
  if (bodyweightKg == null || !Number.isFinite(bodyweightKg) || bodyweightKg <= 0) return null;
  const bandLo = (bandPctPerWeek.lo / 100) * bodyweightKg;
  const bandHi = (bandPctPerWeek.hi / 100) * bodyweightKg;
  return {
    lossKgPerWeek: loss,
    loKgPerWeek: lo,
    hiKgPerWeek: hi,
    weighIns: fit.weighIns,
    spanDays: fit.spanDays,
    bandLoKgPerWeek: bandLo,
    bandHiKgPerWeek: bandHi,
    verdict: verdictFor(lo, hi, bandLo, bandHi),
  };
}
function verdictFor(
  lo: number,
  hi: number,
  bandLo: number,
  bandHi: number,
): ResponseVerdict | null {
  if (lo > bandHi) return 'too_fast';
  if (lo >= bandLo && hi <= bandHi) return 'in_band';
  if (hi < 0) return 'gaining';
  if (hi < bandLo) return 'too_slow';
  return null;
}
export function formatRange(r: WeightResponse): string {
  const signed = (n: number) => `${n > 0 ? '+' : '−'}${Math.abs(n).toFixed(2)}`;
  return `${signed(-r.lossKgPerWeek)} kg/wk (95% CI ${signed(-r.hiKgPerWeek)} to ${signed(-r.loKgPerWeek)}, ${Math.round(r.spanDays)} days)`;
}
export type ResponseState = 'verdict' | 'undecided' | 'insufficient';
export function responseState(result: WeightResponse | null): ResponseState {
  if (!result) return 'insufficient';
  return result.verdict ? 'verdict' : 'undecided';
}
export const RECOVERY_MIN_CYCLES = 2;
export const RECOVERY_MIN_NIGHTS_PER_CYCLE = 3;
export const RECOVERY_MAX_CYCLE_DAYS = 14;
export const RECOVERY_MIN_BASELINE_NIGHTS = 5;
export const RECOVERY_MIN_CYCLES_PER_OFFSET = 2;
export type RecoveryMetric = 'rhr' | 'hrv';
export interface RecoveryNight {
  date: string;
  restingHr: number | null;
  hrvMs: number | null;
}
export interface RecoveryDose extends DoseLogEntry {
  takenAt: string | null;
}
export interface RecoveryOffset {
  offset: number;
  cycles: number;
  median: number | null;
  p25: number | null;
  p75: number | null;
}
export interface RecoveryBaseline {
  median: number;
  iqr: number;
  nights: number;
  source: 'before_first_dose' | 'all_nights';
}
export type MetricRecoveryResponse =
  | {
      state: 'insufficient';
      cycles: number;
      neededCycles: number;
    }
  | {
      state: 'ok';
      cycles: number;
      baseline: RecoveryBaseline;
      offsets: RecoveryOffset[];
    };
export interface DoseLevelRecovery {
  amount: number | null;
  unit: string | null;
  doseText: string | null;
  doses: number;
  timedDoses: number;
  untimedDoses: number;
  timeDayDisagrees: number;
  rhr: MetricRecoveryResponse;
  hrv: MetricRecoveryResponse;
}
export interface SubstanceRecoveryResponse {
  supplementId: string;
  supplementName: string;
  levels: DoseLevelRecovery[];
  mixedDoseLevels: boolean;
}
export interface RecoveryResponseInput {
  doses: RecoveryDose[];
  nights: RecoveryNight[];
  tz: string;
}
const dayKey = (d: string) => d.replace(/\//g, '-');
const finite = (n: number | null | undefined): n is number =>
  typeof n === 'number' && Number.isFinite(n);
function sameLevel(a: DoseLogEntry, b: DoseLogEntry): boolean {
  if ((a.amount != null) !== (b.amount != null)) return false;
  return !doseDiffers(a, b);
}
function metricResponse(
  metric: RecoveryMetric,
  cycles: string[][],
  byDate: Map<string, RecoveryNight>,
  baseline: RecoveryBaseline | null,
): MetricRecoveryResponse {
  const read = (date: string): number | null => {
    const n = byDate.get(date);
    const v = n ? (metric === 'rhr' ? n.restingHr : n.hrvMs) : null;
    return finite(v) ? v : null;
  };
  const usable = cycles
    .map((days) =>
      days.flatMap((d, offset) => {
        const value = read(d);
        return value === null ? [] : [{ offset, value }];
      }),
    )
    .filter((readings) => readings.length >= RECOVERY_MIN_NIGHTS_PER_CYCLE);
  if (!baseline || usable.length < RECOVERY_MIN_CYCLES) {
    return { state: 'insufficient', cycles: usable.length, neededCycles: RECOVERY_MIN_CYCLES };
  }
  const maxOffset = Math.max(...usable.flatMap((c) => c.map((r) => r.offset)));
  const offsets: RecoveryOffset[] = [];
  for (let offset = 0; offset <= maxOffset; offset++) {
    const deviations = usable.flatMap((c) =>
      c.filter((r) => r.offset === offset).map((r) => r.value - baseline.median),
    );
    const enough = deviations.length >= RECOVERY_MIN_CYCLES_PER_OFFSET;
    offsets.push({
      offset,
      cycles: deviations.length,
      median: enough ? median(deviations) : null,
      p25: enough ? quantile(deviations, 0.25) : null,
      p75: enough ? quantile(deviations, 0.75) : null,
    });
  }
  return { state: 'ok', cycles: usable.length, baseline, offsets };
}
function baselineFor(
  metric: RecoveryMetric,
  nights: RecoveryNight[],
  firstDoseDate: string,
): RecoveryBaseline | null {
  const valuesOf = (rows: RecoveryNight[]) =>
    rows.map((n) => (metric === 'rhr' ? n.restingHr : n.hrvMs)).filter(finite);
  const pre = valuesOf(nights.filter((n) => n.date < firstDoseDate));
  const source =
    pre.length >= RECOVERY_MIN_BASELINE_NIGHTS ? 'before_first_dose' : 'all_nights';
  const values = source === 'before_first_dose' ? pre : valuesOf(nights);
  const band = iqrBand(values, 0);
  return band
    ? { median: band.median, iqr: band.high - band.low, nights: values.length, source }
    : null;
}
export function recoveryResponse(input: RecoveryResponseInput): SubstanceRecoveryResponse[] {
  const nights = input.nights
    .map((n) => ({ ...n, date: dayKey(n.date) }))
    .filter((n) => isCalendarDate(n.date))
    .sort((a, b) => a.date.localeCompare(b.date));
  const byDate = new Map(nights.map((n) => [n.date, n]));
  const doses = input.doses
    .map((d) => ({ ...d, date: dayKey(d.date) }))
    .filter((d) => isCalendarDate(d.date))
    .sort(
      (a, b) =>
        a.date.localeCompare(b.date) || (a.takenAt ?? '').localeCompare(b.takenAt ?? ''),
    );
  const bySubstance = new Map<string, typeof doses>();
  for (const d of doses) {
    const list = bySubstance.get(d.supplementId) ?? [];
    if (!list.some((x) => x.date === d.date)) list.push(d);
    bySubstance.set(d.supplementId, list);
  }
  const out: SubstanceRecoveryResponse[] = [];
  for (const [supplementId, list] of bySubstance) {
    const baselines = {
      rhr: baselineFor('rhr', nights, list[0].date),
      hrv: baselineFor('hrv', nights, list[0].date),
    };
    const groups: {
      rep: DoseLogEntry;
      members: {
        dose: (typeof list)[number];
        days: string[];
      }[];
    }[] = [];
    list.forEach((dose, i) => {
      const gap =
        i + 1 < list.length
          ? daysBetweenDateStrs(dose.date, list[i + 1].date)
          : RECOVERY_MAX_CYCLE_DAYS;
      const days = Array.from({ length: Math.min(gap, RECOVERY_MAX_CYCLE_DAYS) }, (_, k) =>
        shiftDateStr(dose.date, k),
      );
      let group = groups.find((g) => sameLevel(g.rep, dose));
      if (!group) groups.push((group = { rep: dose, members: [] }));
      group.members.push({ dose, days });
    });
    const levels: DoseLevelRecovery[] = groups.map((g) => {
      const cycles = g.members.map((m) => m.days);
      const timed = g.members.filter(
        (m) => m.dose.takenAt && !Number.isNaN(Date.parse(m.dose.takenAt)),
      );
      return {
        amount: g.rep.amount,
        unit: g.rep.unit,
        doseText: g.rep.doseText,
        doses: g.members.length,
        timedDoses: timed.length,
        untimedDoses: g.members.length - timed.length,
        timeDayDisagrees: timed.filter(
          (m) => toAestDay(new Date(m.dose.takenAt as string), input.tz) !== m.dose.date,
        ).length,
        rhr: metricResponse('rhr', cycles, byDate, baselines.rhr),
        hrv: metricResponse('hrv', cycles, byDate, baselines.hrv),
      };
    });
    out.push({
      supplementId,
      supplementName: list[0].supplementName,
      levels,
      mixedDoseLevels: levels.length > 1,
    });
  }
  return out.sort(
    (a, b) =>
      a.supplementName.localeCompare(b.supplementName) ||
      a.supplementId.localeCompare(b.supplementId),
  );
}
export interface MetricPattern {
  clear: boolean;
  clearOffsets: number[];
  peak: {
    offset: number;
    value: number;
    direction: 'up' | 'down';
  } | null;
  last: {
    offset: number;
    value: number;
    outside: boolean;
  } | null;
}
export function metricPattern(r: MetricRecoveryResponse): MetricPattern {
  if (r.state !== 'ok') return { clear: false, clearOffsets: [], peak: null, last: null };
  const half = r.baseline.iqr / 2;
  const clearOffsets: number[] = [];
  let peak: MetricPattern['peak'] = null;
  let last: MetricPattern['last'] = null;
  for (const o of r.offsets) {
    if (o.median === null || o.p25 === null || o.p75 === null) continue;
    last = {
      offset: o.offset,
      value: r.baseline.median + o.median,
      outside: Math.abs(o.median) > half,
    };
    if (o.p25 > half || o.p75 < -half) {
      clearOffsets.push(o.offset);
      if (!peak || Math.abs(o.median) > Math.abs(peak.value - r.baseline.median)) {
        peak = {
          offset: o.offset,
          value: r.baseline.median + o.median,
          direction: o.median >= 0 ? 'up' : 'down',
        };
      }
    }
  }
  return { clear: clearOffsets.length > 0, clearOffsets, peak, last };
}
