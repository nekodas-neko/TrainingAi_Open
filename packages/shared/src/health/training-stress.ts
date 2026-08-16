import { runTrainingStressScore } from '@/lib/oura-models/inference/ots'
import { deriveVo2Max, type Vo2MaxInputs } from '@trainingai/shared/health/vo2max'

export type TrainingStressResult =
  | { status: 'ok'; ots: number; high: boolean; vo2max: number | null; vo2maxMethod: string | null }
  | { status: 'gated'; reason: 'readiness_learning' | 'no_readiness' | 'insufficient_met' | 'no_profile' }

export interface TrainingStressInputs {
  startTimestampMs: number
  metsPerMinute: (number | null)[]     // day's 1-min MET series (nulls → NaN, cleaned by the core)
  age: number | null
  sex: string | null
  rhr: number | null                   // body_metrics.resting_heart_rate
  readiness: number | null             // persisted oura_daily_derived.readiness_score
  readinessProvisional: boolean        // true while composite baseline still learning
  vo2maxInputs: Vo2MaxInputs
  tzChange: 0 | 1
}

/** Rebuild the OTS input as a true 1-minute MET grid indexed by wall-clock minute (review J-6).
 *  The ring's 0x50 activity events each carry a run of consecutive 1-min MET bins under a single
 *  event timestamp; per the BLE batching convention (oura-native-ble §8) that shared timestamp is
 *  the batch's LAST sample and earlier bins step backward one minute each. `getOuraDaytimeSignals`
 *  stamps every bin in an event with that one event ts, so flattening the bins by array index (the
 *  previous behaviour) silently compressed any non-wear/charger gap between events — shifting the
 *  whole afternoon earlier and skewing the OTS recency weights. Here each bin is placed at its
 *  absolute minute and inter-event gaps are left null, which the OTS core NaN-cleans (and gates on
 *  when coverage drops below 360 valid minutes). For contiguous events it reproduces the old
 *  flattening exactly; it only diverges — correctly — across real gaps. */
export function metGridFromDaytimeSamples(
  samples: { tsMs: number; value: number }[],
): { startTimestampMs: number; metsPerMinute: (number | null)[] } {
  if (samples.length === 0) return { startTimestampMs: 0, metsPerMinute: [] }
  // Group consecutive equal-timestamp bins back into their source event (decoder order preserved).
  const events: { tsMs: number; values: number[] }[] = []
  for (const m of samples) {
    const last = events[events.length - 1]
    if (last && last.tsMs === m.tsMs) last.values.push(m.value)
    else events.push({ tsMs: m.tsMs, values: [m.value] })
  }
  events.sort((a, b) => a.tsMs - b.tsMs)

  const MIN = 60_000
  const first = events[0]
  // Anchor the grid at the earliest bin's minute (that event's first bin = ts − (n−1) minutes).
  const gridStartMs = Math.floor((first.tsMs - (first.values.length - 1) * MIN) / MIN) * MIN
  const placed: { idx: number; value: number }[] = []
  let lastIdx = 0
  for (const ev of events) {
    const n = ev.values.length
    for (let j = 0; j < n; j++) {
      const binMs = ev.tsMs - (n - 1 - j) * MIN
      const idx = Math.round((binMs - gridStartMs) / MIN)
      if (idx < 0) continue
      placed.push({ idx, value: ev.values[j] })
      if (idx > lastIdx) lastIdx = idx
    }
  }
  const grid: (number | null)[] = new Array(lastIdx + 1).fill(null)
  for (const p of placed) grid[p.idx] = p.value
  return { startTimestampMs: gridStartMs, metsPerMinute: grid }
}

/** Assemble the day's Training Stress Score from persisted derived readiness + derived VO₂max +
 *  the MET series. Gates (returns a reason, never fabricates) when readiness is missing/learning,
 *  the profile is incomplete, or there isn't enough MET signal. Pure — the route does the DB IO. */
export function computeTrainingStress(i: TrainingStressInputs): TrainingStressResult {
  if (i.readiness == null) return { status: 'gated', reason: 'no_readiness' }
  if (i.readinessProvisional) return { status: 'gated', reason: 'readiness_learning' }
  if (i.age == null || i.sex == null || i.rhr == null) return { status: 'gated', reason: 'no_profile' }
  const validMin = i.metsPerMinute.filter(v => v != null && v >= 0.9).length
  if (i.metsPerMinute.length < 720 || validMin < 360) return { status: 'gated', reason: 'insufficient_met' }

  const vo2 = deriveVo2Max(i.vo2maxInputs)
  const biologicalSex = i.sex === 'female' ? -1 : i.sex === 'male' ? 1 : 0
  const out = runTrainingStressScore({
    startTimestampMs: i.startTimestampMs,
    mets: Float32Array.from(i.metsPerMinute.map(v => v == null ? NaN : v)),
    age: i.age, biologicalSex, rhr: i.rhr, noOts: 0, tzChange: i.tzChange,
    readiness: i.readiness, vo2max: vo2.value ?? NaN,
  })
  if (!out) return { status: 'gated', reason: 'insufficient_met' }
  return { status: 'ok', ots: out.ots, high: out.high, vo2max: vo2.value, vo2maxMethod: vo2.method }
}
