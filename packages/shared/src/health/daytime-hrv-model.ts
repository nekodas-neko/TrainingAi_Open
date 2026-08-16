/**
 * D5 — own daytime-HRV imputation. Replaces Oura's `dhrv_imputation_1_1_0` ONNX model with a
 * per-user linear regression `ln(rmssd) = a + b·hr + c·temp`, fit by closed-form OLS from this
 * user's own NIGHT-TIME 0x5d HRV events (dense, real — the ring only streams `0x5d` ~7% of
 * daytime hours, night-only in practice, per the 2026-07-16 on-device probe). Each `0x5d` event
 * already carries its own paired `hr_bpm`, so no separate HR-tag join is needed; temp is matched
 * from the nearest skin-temp event. MET is deliberately NOT a fit feature — night-time MET has
 * almost no variance to learn from, so it's an evaluation-time gate instead (see
 * `evaluateDaytimeHrvModel`). Built with zero knowledge of dHRV's actual output
 * (observe-never-feed) — see docs/superpowers/plans/2026-07-27-d5-own-daytime-hrv.md.
 */
import type { OuraRawSampleRow } from '@/lib/data/repository'
import { MET_ACTIVE_THRESHOLD } from '@trainingai/shared/health/daily-medians'

const HRV_TAG = 0x5d
const TEMP_TAGS = [0x46, 0x69]
const HR_MIN = 35
const HR_MAX = 150
const TEMP_MATCH_WINDOW_MS = 15 * 60_000

// Below this many training buckets the fit is too noisy to trust (roughly a handful of nights'
// worth of 5-min 0x5d events) — mirrors the spirit of MIN_OBS in daily-baselines.ts.
export const MIN_TRAINING_SAMPLES = 50

export interface SleepWindow {
  sleepStart: Date
  sleepEnd: Date
}

export interface TrainingSample {
  hr: number
  temp: number
  rmssd: number
}

export interface DaytimeHrvModel {
  intercept: number
  hrCoef: number
  tempCoef: number
  residualStd: number
  nSamples: number
}

function numArr(decoded: Record<string, unknown> | null, key: string): number[] {
  const v = decoded?.[key]
  return Array.isArray(v) ? v.filter((n): n is number => typeof n === 'number') : []
}

function inSleepWindow(tsMs: number, windows: SleepWindow[]): boolean {
  return windows.some(w => tsMs >= w.sleepStart.getTime() && tsMs < w.sleepEnd.getTime())
}

/**
 * (hr, temp, rmssd) training tuples from decoded raw rows, restricted to sleep windows.
 * Pure — the caller fetches rows via `getOuraRawSamplesForTags(userId, [0x5d,0x46,0x69], days)`
 * and sleep windows via `listSleepSessions`.
 */
export function extractNightlyTrainingSamples(rows: OuraRawSampleRow[], sleepWindows: SleepWindow[]): TrainingSample[] {
  const tempRows = rows
    .filter(r => TEMP_TAGS.includes(r.tag) && r.measuredAt)
    .map(r => ({ tsMs: new Date(r.measuredAt!).getTime(), values: numArr(r.decoded, 'temps_c') }))
    .filter(r => r.values.length > 0)

  const samples: TrainingSample[] = []
  for (const r of rows) {
    if (r.tag !== HRV_TAG || !r.measuredAt) continue
    const tsMs = new Date(r.measuredAt).getTime()
    if (!inSleepWindow(tsMs, sleepWindows)) continue

    const nearbyTemps = tempRows
      .filter(t => Math.abs(t.tsMs - tsMs) <= TEMP_MATCH_WINDOW_MS)
      .flatMap(t => t.values)
    if (nearbyTemps.length === 0) continue
    const temp = nearbyTemps.reduce((s, v) => s + v, 0) / nearbyTemps.length

    const rmssdArr = numArr(r.decoded, 'rmssd_ms')
    const hrArr = numArr(r.decoded, 'hr_bpm')
    for (let i = 0; i < rmssdArr.length; i++) {
      const rmssd = rmssdArr[i]
      const hr = hrArr[i]
      if (!(rmssd > 0)) continue
      if (hr == null || hr < HR_MIN || hr > HR_MAX) continue
      samples.push({ hr, temp, rmssd })
    }
  }
  return samples
}

/** Solve a 3×3 linear system by Cramer's rule. Returns null when the system is singular. */
function solve3x3(A: number[][], b: number[]): number[] | null {
  const det3 = (m: number[][]) =>
    m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) -
    m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) +
    m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0])

  const D = det3(A)
  if (Math.abs(D) < 1e-9) return null

  const withCol = (col: number) => A.map((row, i) => row.map((v, j) => (j === col ? b[i] : v)))
  return [0, 1, 2].map(col => det3(withCol(col)) / D)
}

/**
 * Fit `ln(rmssd) = intercept + hrCoef·hr + tempCoef·temp` by ordinary least squares (closed-form
 * normal equations — 3 parameters, no numerics library needed). Returns null below
 * `MIN_TRAINING_SAMPLES` or if the system is singular (e.g. near-zero HR/temp variance).
 */
export function fitDaytimeHrvModel(samples: TrainingSample[]): DaytimeHrvModel | null {
  const n = samples.length
  if (n < MIN_TRAINING_SAMPLES) return null

  let sumHr = 0, sumTemp = 0, sumHr2 = 0, sumTemp2 = 0, sumHrTemp = 0, sumY = 0, sumHrY = 0, sumTempY = 0
  for (const s of samples) {
    const y = Math.log(s.rmssd)
    sumHr += s.hr; sumTemp += s.temp
    sumHr2 += s.hr * s.hr; sumTemp2 += s.temp * s.temp; sumHrTemp += s.hr * s.temp
    sumY += y; sumHrY += s.hr * y; sumTempY += s.temp * y
  }

  const A = [
    [n, sumHr, sumTemp],
    [sumHr, sumHr2, sumHrTemp],
    [sumTemp, sumHrTemp, sumTemp2],
  ]
  const coef = solve3x3(A, [sumY, sumHrY, sumTempY])
  if (!coef) return null
  const [intercept, hrCoef, tempCoef] = coef
  if (!coef.every(Number.isFinite)) return null

  let sqErr = 0
  for (const s of samples) {
    const pred = intercept + hrCoef * s.hr + tempCoef * s.temp
    const err = Math.log(s.rmssd) - pred
    sqErr += err * err
  }
  const residualStd = Math.sqrt(sqErr / n)

  return { intercept, hrCoef, tempCoef, residualStd, nSamples: n }
}

/**
 * Evaluate the fitted model for one moment. Returns null when `met` is above the app's one
 * active-period threshold (`MET_ACTIVE_THRESHOLD`) — the model was fit on resting/sleep HR↔HRV
 * behaviour and would mis-extrapolate to exercise-elevated HR, a regime it never saw. Infallible:
 * an invalid input or a non-finite/non-positive result returns null, never a wrong number.
 */
export function evaluateDaytimeHrvModel(model: DaytimeHrvModel, hr: number, temp: number, met: number): number | null {
  if (met > MET_ACTIVE_THRESHOLD) return null
  if (!Number.isFinite(hr) || !Number.isFinite(temp)) return null
  const rmssd = Math.exp(model.intercept + model.hrCoef * hr + model.tempCoef * temp)
  return Number.isFinite(rmssd) && rmssd > 0 ? rmssd : null
}

/**
 * Per-bucket dHRV estimates over `[fromMs, toMs)` — the one place buckets get built from raw
 * temp/met/hr windows and evaluated against the model. Shared by the production stress pipeline
 * (`buildDaytimeStressSeriesFromModel`, 30-min buckets) and the D6 comparison-harness adapter
 * (5-min buckets, to give a short admin spot-check window more than one or two points). Buckets
 * are aligned to an ABSOLUTE epoch grid (`floor(fromMs/bucketMs)*bucketMs`), not to `fromMs`
 * itself — the harness merges this function's output against an independently-bucketed reference
 * series by bucket key, so both sides must land on the same grid regardless of the exact window
 * requested. (Inconsequential for production: AEST midnight is already 30-min-grid-aligned to
 * epoch, so this changes nothing there.) A bucket needs HR, temp AND met data to be scored —
 * missing any of the three skips it rather than guessing (same "return nothing rather than a
 * wrong number" contract as `evaluateDaytimeHrvModel`).
 */
export function daytimeHrvEstimatesPerBucket(
  model: DaytimeHrvModel,
  temp: { tsMs: number; valueC: number }[],
  met: { tsMs: number; value: number }[],
  hr: { tsMs: number; bpm: number }[],
  fromMs: number,
  toMs: number,
  bucketMs: number,
): { t: number; dhrv: number }[] {
  const out: { t: number; dhrv: number }[] = []
  const gridStart = Math.floor(fromMs / bucketMs) * bucketMs
  for (let bStart = gridStart; bStart < toMs; bStart += bucketMs) {
    const bEnd = bStart + bucketMs
    const hrBucket = hr.filter(h => h.tsMs >= bStart && h.tsMs < bEnd).map(h => h.bpm).sort((a, b) => a - b)
    if (hrBucket.length === 0) continue
    const hrMedian = hrBucket[Math.floor(hrBucket.length / 2)]
    const tempBucket = temp.filter(t => t.tsMs >= bStart && t.tsMs < bEnd).map(t => t.valueC)
    if (tempBucket.length === 0) continue
    const tempAvg = tempBucket.reduce((s, v) => s + v, 0) / tempBucket.length
    const metBucket = met.filter(m => m.tsMs >= bStart && m.tsMs < bEnd).map(m => m.value)
    if (metBucket.length === 0) continue
    const metMax = Math.max(...metBucket)
    const dhrv = evaluateDaytimeHrvModel(model, hrMedian, tempAvg, metMax)
    if (dhrv != null) out.push({ t: Math.round(bStart + bucketMs / 2), dhrv })
  }
  return out
}
