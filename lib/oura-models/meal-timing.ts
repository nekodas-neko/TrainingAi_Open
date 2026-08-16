// meal_timing_0_1_0 (MealWindowClustering) — a faithful TypeScript port of the 0-parameter
// algorithmic TorchScript model. Given a user's meal-log unix timestamps + per-log timezone offsets,
// it histograms them into 48 half-hour bins of the day, finds frequent bins, clusters them into meal
// windows (with day wrap-around), and returns each window as [minutesPastMidnight, durationMinutes]
// plus a consistency flag (1 / 0 / NaN). Pinned to the captured .pt golden vector
// (lib/oura-models/onnx/__fixtures__/meal_timing_0_1_0.golden.json). Ported verbatim from
// the vendor's `meal_timing_0_1_0` model source (private archive). Do NOT re-derive constants or "improve" it.

// Vendored constants (meal_timing_0_1_0.constants.json).
const MIN_BETWEEN_WINDOW_DISTANCE_HOURS = 1
const MIN_CLUSTER_ELEMENTS = 2
const MIN_CLUSTER_ELEMENTS_PERCENTAGE = 0.1
const MIN_SCALED_MEAL_FREQUENCY = 0.2
const EXTENSION_LENGTH = 12
const CONSISTENCY_MEALS_WITHIN_CLUSTERS_THRESHOLD = 0.7
const CONSISTENCY_MAX_CLUSTER_LENGTH_HOURS_THRESHOLD = 3
const CONSISTENCY_MIN_TOTAL_MEALS_LOGGED = 10

export interface MealTimingResult {
  /** each window: [minutes past midnight of the window start, window duration in minutes] */
  clusters: [number, number][]
  /** 1 = consistent, 0 = inconsistent, NaN = too few meals to judge */
  consistency: number
}

const sum = (a: number[]): number => a.reduce((s, v) => s + v, 0)

// torch.histc(x, 48, 0, 1440): 48 equal-width buckets over [0,1440]; values outside are ignored.
// Bucket for v = floor(v * 48 / 1440) = floor(v / 30); value == max(1440) would land in the last bucket.
function histc48(values: number[]): number[] {
  const bins = new Array(48).fill(0)
  for (const v of values) {
    if (v < 0 || v > 1440) continue
    let b = Math.floor((v * 48) / 1440)
    if (b === 48) b = 47
    bins[b] += 1
  }
  return bins
}

// Preprocessor.run → the 48 half-hour meal-frequency bins, extended by the first EXTENSION_LENGTH
// bins (day wrap-around) to length 60, plus the scaled (÷max) version.
function preprocess(unixTimestamps: number[], unixTimezones: number[]): { freq: number[]; scaled: number[] } {
  const n = Math.min(unixTimestamps.length, unixTimezones.length)
  const rounded: number[] = []
  for (let i = 0; i < n; i++) {
    const localized = unixTimestamps[i] + unixTimezones[i]
    const mpm = Math.floor(((localized % 86400) + 86400) % 86400 / 60) // minutes past midnight
    const r = (Math.floor((mpm + 15) / 30) * 30) % 1440                // round to nearest half-hour
    rounded.push(r)
  }
  const bins = histc48(rounded)
  const maxBin = Math.max(...bins)
  const scaledBins = bins.map(b => (maxBin > 0 ? b / maxBin : 0))
  const extend = (t: number[]) => [...t, ...t.slice(0, EXTENSION_LENGTH)]
  return { freq: extend(bins), scaled: extend(scaledBins) }
}

// get_clusters: frequent bins (scaled ≥ threshold) grouped where consecutive frequent-bin indices are
// ≤ 2 apart (min_between_window_distance_hours × 2). Returns [startBin, endBin] pairs.
function getClusters(scaled: number[]): [number, number][] {
  const idx: number[] = []
  for (let i = 0; i < scaled.length; i++) if (scaled[i] >= MIN_SCALED_MEAL_FREQUENCY) idx.push(i)
  const frequentCount = idx.length
  if (frequentCount === 0) return []
  const timeDiffs: number[] = []
  for (let i = 1; i < idx.length; i++) timeDiffs.push(idx[i] - idx[i - 1])

  const clusters: [number, number][] = []
  let start = idx[0], end = idx[0]
  const gap = MIN_BETWEEN_WINDOW_DISTANCE_HOURS * 2
  for (let index = 0; index < timeDiffs.length; index++) {
    if (timeDiffs[index] > gap) {
      clusters.push([start, end])
      start = idx[index + 1]; end = idx[index + 1]
    } else {
      end = idx[index + 1]
    }
    if (index === timeDiffs.length - 1) clusters.push([start, end])
  }
  if (timeDiffs.length === 0 && frequentCount > 0) clusters.push([start, end])
  return clusters
}

// post_process_clusters: keep clusters with enough logged meals (both a % of the total and an absolute
// floor); single-bin clusters widen ±0.5; stop once a cluster's end crosses into the wrap region (≥48);
// then drop a leading cluster fully covered by the trailing wrap.
function postProcess(freq: number[], clusters: [number, number][]): [number, number][] {
  const clean: [number, number][] = []
  const totalLogged = sum(freq)
  for (let i = 0; i < clusters.length; i++) {
    const [s, e] = clusters[i]
    const loggedInCluster = sum(freq.slice(s, e + 1))
    let stop = false
    if (loggedInCluster >= MIN_CLUSTER_ELEMENTS_PERCENTAGE * totalLogged && loggedInCluster >= MIN_CLUSTER_ELEMENTS) {
      let cs = s, ce = e
      if (cs === ce) { cs -= 0.5; ce += 0.5 }
      clean.push([cs, ce])
      if (ce >= 48) stop = true
    }
    if (stop) break
  }
  if (clean.length >= 2) {
    const first = clean[0], last = clean[clean.length - 1]
    if (last[1] - 48 >= first[0] && last[1] - 48 <= first[1]) return clean.slice(1)
  }
  return clean
}

function toMinutes(clusters: [number, number][]): [number, number][] {
  return clusters.map(([s, e]) => [Math.trunc(s * 30), Math.trunc((e - s + 1) * 30)])
}

function calcConsistency(clusters: [number, number][], clustersMinutes: [number, number][], freq: number[]): number {
  const totalLogged = sum(freq)
  if (clusters.length === 0 || totalLogged < CONSISTENCY_MIN_TOTAL_MEALS_LOGGED) return NaN
  const maxDuration = Math.max(...clustersMinutes.map(c => c[1]))
  let loggedInClusters = 0
  for (const [s, e] of clusters) loggedInClusters += sum(freq.slice(Math.trunc(s), Math.trunc(e) + 1))
  const pct = loggedInClusters / totalLogged
  const ok = pct >= CONSISTENCY_MEALS_WITHIN_CLUSTERS_THRESHOLD &&
    maxDuration <= CONSISTENCY_MAX_CLUSTER_LENGTH_HOURS_THRESHOLD * 60
  return ok ? 1 : 0
}

/** Run the meal-timing clustering model. Infallible — an empty/degenerate input yields no clusters and
 *  a NaN consistency (the model's validate/error path), never throws. */
export function runMealTiming(unixTimestamps: number[], unixTimezones: number[]): MealTimingResult {
  if (unixTimestamps.length === 0 || unixTimezones.length === 0 || unixTimestamps.length !== unixTimezones.length) {
    return { clusters: [], consistency: NaN }
  }
  const { freq, scaled } = preprocess(unixTimestamps, unixTimezones)
  const raw = getClusters(scaled)
  const clean = postProcess(freq, raw)
  const minutes = toMinutes(clean)
  const consistency = calcConsistency(clean, minutes, freq)
  return { clusters: minutes, consistency }
}
