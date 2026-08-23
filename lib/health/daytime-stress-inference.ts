/**
 * The ONNX half of the daytime-stress engine — Oura `dhrv_imputation_1_1_0`.
 *
 * Split out of `daytime-stress.ts` on 2026-08-23 for the same reason `daytime-stress-thresholds.ts`
 * was split out before it: this is the only part that reaches an inference runtime, and the Oura
 * rollup — which imports the scoring half and must be able to run in a WebView — was pulling
 * `onnxruntime-node` into its module graph through a function it never calls. It calls
 * `buildDaytimeStressSeriesFromModel` (D5's own regression), which is synchronous and runs no model.
 *
 * Feature assembly (`dhrvFeatures`) and the stress-level rule stay in `daytime-stress.ts`; they are
 * plain maths and are shared by both dhrv sources.
 */
import { runDhrvImputation, DHRV_FEATURES } from '@/lib/oura-models/inference/dhrv'
import { getDhrvScaling } from '@/lib/oura-models/constants'
import type { ModelRuntime } from '@/lib/oura-models/inference/runtime'
import { STRESS_BUCKET_MS } from '@trainingai/shared/health/daytime-stress-thresholds'
import {
  dhrvFeatures,
  scoreStressPoints,
  type DaytimeStress,
  type DhrvBaselines,
  type StressPoint,
} from './daytime-stress'

// Per-feature scaling stats, read from the vendored constants rather than copied into this file.
// They were inline here until 2026-08-10, where no check could see them: `check-private-paths`
// looks for imports of private material, and a number typed into a source file has no import.
// Feature order: hr_median, hr_min, hr_max, temp_skin, temp_skin_std30, temp_skin_avg30,
// met_std15, met_avg60, dhrv_baseline, hr_baseline.
// Read on first use, not at module scope: `next build` imports every route to collect page data, so
// a module-scope read opens the constants file at build time — and the directory only exists at
// runtime now that the vendored copies are gone (Q-49 A4b).
let dhrvScaling: ReturnType<typeof getDhrvScaling> | null = null

/**
 * Impute daytime HRV + stress for one time-window. Returns null on any inference failure or empty
 * inputs (caller shows/uses nothing rather than a wrong number). Infallible by contract.
 */
export async function computeDaytimeStress(
  temp: number[], met: number[], hr: number[], b: DhrvBaselines, runtime: ModelRuntime,
): Promise<DaytimeStress | null> {
  if (temp.length === 0 || met.length === 0 || hr.length === 0) return null
  if (![b.dhrvBaseline, b.hrBaseline, b.tempBaseline].every(v => Number.isFinite(v) && v > 0)) return null
  const feats = dhrvFeatures(temp, met, hr, b)
  const scaled = new Float32Array(DHRV_FEATURES)
  const { means: MEANS, stds: STDS } = (dhrvScaling ??= getDhrvScaling())
  for (let i = 0; i < DHRV_FEATURES; i++) scaled[i] = (feats[i] - MEANS[i]) / STDS[i]
  const dhrv = await runDhrvImputation(scaled, runtime)
  if (dhrv == null || !(dhrv > 0)) return null
  return { dhrv, stress: dhrv - b.dhrvBaseline }
}

/**
 * Build a daytime stress series by imputing dHRV per time bucket across `[fromMs, toMs)`.
 * A bucket is scored only when it has HR (the ring must have been sensing); temp/MET use the
 * trailing window the model expects (≤30 temp, ≤60 MET). `relStress` is each bucket's dhrv minus
 * the day's median dhrv. Returns [] when there isn't enough data (caller applies no modifier).
 */
export async function buildDaytimeStressSeries(
  temp: { tsMs: number; valueC: number }[],
  met: { tsMs: number; value: number }[],
  hr: { tsMs: number; bpm: number }[],
  b: DhrvBaselines,
  fromMs: number,
  toMs: number,
  runtime: ModelRuntime,
  bucketMs = STRESS_BUCKET_MS,
): Promise<StressPoint[]> {
  if (hr.length === 0 || temp.length === 0 || met.length === 0) return []
  const raw: { t: number; dhrv: number }[] = []
  for (let bStart = fromMs; bStart < toMs; bStart += bucketMs) {
    const bEnd = bStart + bucketMs
    const hrBucket = hr.filter(h => h.tsMs >= bStart && h.tsMs < bEnd).map(h => h.bpm).sort((x, y) => x - y)
    if (hrBucket.length === 0) continue
    const hrMMM = [hrBucket[0], hrBucket[Math.floor(hrBucket.length / 2)], hrBucket[hrBucket.length - 1]]
    const tempWin = temp.filter(t => t.tsMs <= bEnd).slice(-30).map(t => t.valueC)
    const metWin = met.filter(m => m.tsMs <= bEnd).slice(-60).map(m => m.value)
    if (tempWin.length === 0 || metWin.length === 0) continue
    const out = await computeDaytimeStress(tempWin, metWin, hrMMM, b, runtime)
    if (out) raw.push({ t: Math.round(bStart + bucketMs / 2), dhrv: out.dhrv })
  }
  return scoreStressPoints(raw, b)
}

