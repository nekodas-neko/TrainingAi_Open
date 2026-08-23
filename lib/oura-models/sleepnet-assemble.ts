/**
 * Assemble a SleepNet raw-night from decoded BLE rows and run the neural stager — the bridge
 * between `oura_raw_samples` and `preprocessSleepNet` → `runSleepNet`.
 *
 * DEVICE-VALIDATION STAGE: the per-beat IBI timestamp reconstruction (below) is an assumption that
 * can only be confirmed against real ring data — this is exactly what the admin SleepNet dump is
 * for. Until a real-night dump confirms a sane REM% (~23–28%), this must NOT replace the heuristic
 * stager in production; it runs only behind the admin debug gate.
 */
import { preprocessSleepNet, type SleepNetRawNight } from '@trainingai/shared/health/sleepnet-preprocess'
import { runSleepNet, type StageCode } from '@/lib/oura-models/inference/sleepnet'
import type { ModelRuntime } from '@/lib/oura-models/inference/runtime'
import type { SleepStage } from '@trainingai/shared/health/hypnogram'

const CODE_TO_STAGE: Record<number, SleepStage> = { 1: 'deep', 2: 'light', 3: 'rem', 4: 'awake' }

export interface SleepNetAssembleInput {
  bedtimeStartMs: number
  bedtimeEndMs: number
  /** 0x80 green-IBI rows in window: event time (ms) + per-beat IBI intervals (ms) + quality flags. */
  ibiRows: { tsMs: number; ibiMs: number[]; quality: number[] }[]
  /** 0x72 motion rows: event time (ms) + mean acm_mad for the row. */
  motionRows: { tsMs: number; acmMad: number }[]
  /** 0x6f SpO2 rows: event time (ms) + the row's SpO2 samples (%). */
  spo2Rows: { tsMs: number; spo2: number[] }[]
}

export interface SleepNetDump {
  bedtimeStartMs: number
  bedtimeEndMs: number
  durationH: number
  counts: { ibiBeats: number; motion: number; spo2: number }
  ibiMeanMs: number | null
  ibiSpanMin: number | null
  /** null when inference/preprocess fell back */
  staging: {
    /** compressed run-length hypnogram, e.g. "4x12,2x40,3x18,..." (code x epochs) */
    hypnogramRle: string
    stagePct: { deep: number; light: number; rem: number; awake: number }
    remPct: number
    epochs: number
  } | null
  /** Breathing-disturbance estimate from SleepNet's apnea head. Observational, not a diagnosis. */
  apnea: {
    /** asleep epochs flagged as disturbed breathing (30-s each) within the real window */
    disturbedEpochs: number
    /** disturbed epochs per hour of sleep — a coarse breathing-disturbance index */
    perHour: number
    /** % of asleep epochs flagged */
    pctOfSleep: number
  } | null
  fallbackReason: string | null
}

/**
 * Reconstruct absolute per-beat timestamps for one green-IBI batch. ASSUMPTION (to be validated
 * on-device): the event `tsMs` marks the last beat of the batch and each earlier beat is `ibiMs[k]`
 * before the next. If a real-night dump shows an implausible REM%, flip to a forward anchor.
 */
function beatTimes(tsMs: number, ibiMs: number[]): number[] {
  const out = new Array<number>(ibiMs.length)
  let t = tsMs
  for (let k = ibiMs.length - 1; k >= 0; k--) {
    out[k] = t
    t -= ibiMs[k]
  }
  return out
}

export function assembleSleepNetNight(input: SleepNetAssembleInput): SleepNetRawNight {
  const tsMs: number[] = []
  const ibiMs: number[] = []
  const amplitude: number[] = []
  const valid: number[] = []
  // IBI amplitude is not carried on 0x80 and the model's amplitude channel is degenerate
  // (near-constant → zscore → 0), so a constant is faithful here.
  for (const row of input.ibiRows) {
    const times = beatTimes(row.tsMs, row.ibiMs)
    for (let k = 0; k < row.ibiMs.length; k++) {
      tsMs.push(times[k])
      ibiMs.push(row.ibiMs[k])
      amplitude.push(1)
      valid.push(row.quality[k] ?? 1)
    }
  }
  // sort beats by time (batches may arrive out of order)
  const order = tsMs.map((_, i) => i).sort((a, b) => tsMs[a] - tsMs[b])
  const ibi = {
    tsMs: order.map((i) => tsMs[i]),
    ibiMs: order.map((i) => ibiMs[i]),
    amplitude: order.map((i) => amplitude[i]),
    valid: order.map((i) => valid[i]),
  }
  const motion = {
    tsMs: input.motionRows.map((r) => r.tsMs),
    value: input.motionRows.map((r) => r.acmMad),
  }
  const spTs: number[] = []
  const spV: number[] = []
  for (const r of input.spo2Rows) {
    const mean = r.spo2.length ? r.spo2.reduce((a, b) => a + b, 0) / r.spo2.length : NaN
    if (!Number.isNaN(mean)) {
      spTs.push(r.tsMs)
      spV.push(mean)
    }
  }
  return {
    bedtimeStartMs: input.bedtimeStartMs,
    bedtimeEndMs: input.bedtimeEndMs,
    ibi,
    motion,
    spo2: { tsMs: spTs, value: spV },
  }
}

export interface SleepNetBdi {
  /** asleep epochs flagged as disturbed breathing (30-s each) within the real window */
  disturbedEpochs: number
  /** disturbed epochs per hour of sleep — a coarse breathing-disturbance index */
  perHour: number
  /** % of asleep epochs flagged */
  pctOfSleep: number
}

/**
 * Breathing-disturbance index from SleepNet's apnea head over the REAL bedtime window: count
 * apnea-flagged epochs that fall in ASLEEP epochs (a flag during an awake epoch, code 4, is
 * meaningless and dropped), expressed as disturbed epochs per hour of sleep. Observational, NOT a
 * diagnosis. One place for this math — called by both `sleepNetStages5Min` (production) and
 * `sleepNetDump` (admin). `apneaWin`/`codes` are the already-real-window-sliced arrays.
 */
export function bdiFromApnea(apneaWin: boolean[], codes: StageCode[]): SleepNetBdi {
  let disturbed = 0
  let asleep = 0
  for (let i = 0; i < codes.length; i++) {
    if (codes[i] === 4) continue
    asleep++
    if (apneaWin[i]) disturbed++
  }
  const sleepHours = (asleep * 0.5) / 60
  return {
    disturbedEpochs: disturbed,
    perHour: sleepHours > 0 ? Math.round((disturbed / sleepHours) * 10) / 10 : 0,
    pctOfSleep: asleep ? Math.round((disturbed / asleep) * 1000) / 10 : 0,
  }
}

/**
 * Run SleepNet and return its hypnogram as `nEpochs` 5-min stages aligned to the heuristic stager's
 * grid (majority vote of the 10 underlying 30-s epochs per 5-min bin), so it drops straight into the
 * existing summarize / phase-string pipeline, plus the per-night BDI from the same forward pass's
 * apnea head (a free byproduct we otherwise discard). Returns null on any failure (caller keeps the
 * heuristic).
 */
export async function sleepNetStages5Min(input: SleepNetAssembleInput, nEpochs: number, runtime: ModelRuntime): Promise<{ stages: SleepStage[]; bdi: SleepNetBdi } | null> {
  const pre = preprocessSleepNet(assembleSleepNetNight(input))
  if (!pre) return null
  const result = await runSleepNet(pre.highRes, pre.lowRes, runtime)
  if (!result) return null
  const codes = result.stageCodes.slice(pre.realEpochStart, pre.realEpochStart + pre.realEpochCount)
  const out: SleepStage[] = []
  for (let j = 0; j < nEpochs; j++) {
    const tally = [0, 0, 0, 0, 0] // index by code 1..4
    const end = Math.min((j + 1) * 10, codes.length)
    for (let k = j * 10; k < end; k++) tally[codes[k]]++
    if (j * 10 >= codes.length) {
      out.push('awake') // 5-min bin past the real window (shouldn't happen; align guard)
      continue
    }
    let best = 4
    let bestN = -1
    for (let c = 1; c <= 4; c++)
      if (tally[c] > bestN) {
        bestN = tally[c]
        best = c
      }
    out.push(CODE_TO_STAGE[best])
  }
  const bdi = bdiFromApnea(result.apnea.slice(pre.realEpochStart, pre.realEpochStart + pre.realEpochCount), codes)
  return { stages: out, bdi }
}

function rle(codes: StageCode[]): string {
  const parts: string[] = []
  let cur = codes[0]
  let n = 0
  for (const c of codes) {
    if (c === cur) n++
    else {
      parts.push(`${cur}x${n}`)
      cur = c
      n = 1
    }
  }
  if (n) parts.push(`${cur}x${n}`)
  return parts.join(',')
}

/** Assemble + run SleepNet on a night, returning a copy-pasteable diagnostic dump. */
export async function sleepNetDump(input: SleepNetAssembleInput, runtime: ModelRuntime): Promise<SleepNetDump> {
  const durationH = Math.round(((input.bedtimeEndMs - input.bedtimeStartMs) / 3_600_000) * 100) / 100
  const night = assembleSleepNetNight(input)
  const nBeats = night.ibi.ibiMs.length
  const ibiMeanMs = nBeats ? Math.round(night.ibi.ibiMs.reduce((a, b) => a + b, 0) / nBeats) : null
  const ibiSpanMin =
    nBeats > 1 ? Math.round(((night.ibi.tsMs[nBeats - 1] - night.ibi.tsMs[0]) / 60_000) * 10) / 10 : null

  const dump: SleepNetDump = {
    bedtimeStartMs: input.bedtimeStartMs,
    bedtimeEndMs: input.bedtimeEndMs,
    durationH,
    counts: { ibiBeats: nBeats, motion: night.motion.value.length, spo2: night.spo2.value.length },
    ibiMeanMs,
    ibiSpanMin,
    staging: null,
    apnea: null,
    fallbackReason: null,
  }

  const pre = preprocessSleepNet(night)
  if (!pre) {
    dump.fallbackReason = 'preprocess returned null (unusable night)'
    return dump
  }
  const result = await runSleepNet(pre.highRes, pre.lowRes, runtime)
  if (!result) {
    dump.fallbackReason = 'runSleepNet returned null (inference unavailable/failed)'
    return dump
  }
  // The model always runs on a fixed 15 h (1800-epoch) grid; a real night fills only the middle,
  // so tally stages over the REAL bedtime window only (drop the zero-padding) — otherwise the pad
  // dominates as fake "wake". REM% is of sleep (deep+light+rem), the metric to compare vs Cloud.
  const codes = result.stageCodes.slice(pre.realEpochStart, pre.realEpochStart + pre.realEpochCount)
  const tally = { deep: 0, light: 0, rem: 0, awake: 0 }
  for (const c of codes) {
    if (c === 1) tally.deep++
    else if (c === 2) tally.light++
    else if (c === 3) tally.rem++
    else tally.awake++
  }
  const total = codes.length || 1
  const pct = (n: number) => Math.round((n / total) * 1000) / 10
  const asleep = tally.deep + tally.light + tally.rem
  const remOfSleep = asleep ? Math.round((tally.rem / asleep) * 1000) / 10 : 0
  dump.staging = {
    hypnogramRle: rle(codes),
    stagePct: { deep: pct(tally.deep), light: pct(tally.light), rem: pct(tally.rem), awake: pct(tally.awake) },
    remPct: remOfSleep,
    epochs: total,
  }
  // Breathing-disturbance from the same forward pass's apnea head (One Formula, One Place).
  dump.apnea = bdiFromApnea(result.apnea.slice(pre.realEpochStart, pre.realEpochStart + pre.realEpochCount), codes)
  return dump
}
