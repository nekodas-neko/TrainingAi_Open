import { formatInTimeZone } from 'date-fns-tz'
import { measuredAtMs, decodeEventBody, hexToBytes } from '@/lib/oura-ble/decode'
import { resolveDsToMs, currentEpoch } from '@/lib/oura-ble/clock'
import { spo2PctFromR } from '@/lib/oura-ble/spo2'
import { STEP_FEATURE_TAGS, STEP_MOTION_TAG } from '@/lib/oura-ble/rollup-consumed-tags'
import { computeStepsByDay } from '@/lib/oura-ble/step-day-buckets'
import { phasesToPhase5Min, stagesToPhase5Min, type SleepStage } from '@trainingai/shared/health/hypnogram'
import { stageSleepDetailed, summarizeSleepStages, refineOnsetLatencySec, EPOCH_MIN, type SleepEpoch, type OnsetSample } from '@trainingai/shared/health/sleep-staging'
import { sleepNetDump, sleepNetStages5Min, type SleepNetAssembleInput } from '@/lib/oura-models/sleepnet-assemble'
import { breathingFromIbi } from '@trainingai/shared/health/breathing-rate'
import { lfhfFromIbi } from '@trainingai/shared/health/hrv-frequency'
import { spo2VariabilityFromSamples } from '@trainingai/shared/health/spo2-variability'
import { nightlyTemperatureCentiC, temperatureFrameSeries } from '@trainingai/shared/health/temperature-baseline'
import { groupSleepPeriods } from '@trainingai/shared/health/sleep-night'
import { computeRecoveryIndex } from '@trainingai/shared/health/recovery-index'
import { type ExclusionWindow } from '@trainingai/shared/health/daily-medians'
import { metExclusionWindows, rmssdSamples, hrvMsFromSamples, nightlyHeartRate, HR_BIN_DS, numericField as numArr } from '@trainingai/shared/health/night-vitals'
import { clampToDenseSensing } from '@/lib/sleep/sensing-span'
import { computeDailySummaries, type NightInput } from '@trainingai/shared/health/daily-summary'
import { computeHrv5MinSeries } from '@trainingai/shared/health/hrv-5min'
import { computeChronicStress, chronicStressScoreToInt, CHRONIC_STRESS_MIN_DAYS, type ChronicStressNightSignals } from '@trainingai/shared/health/chronic-stress-assembly'
import { illnessFromSummaries, illnessZScores } from '@trainingai/shared/health/illness-radar'
import { computeSleepScore, sleepScoreBaselines } from '@trainingai/shared/health/sleep-score'
import { computeReadinessComposite } from '@trainingai/shared/health/readiness-composite'
import { buildDaytimeStressSeriesFromModel, type DhrvBaselines } from '@/lib/health/daytime-stress'
import { computeResilienceForDay, type DailyIndices } from '@/lib/health/stress-resilience'
import type { SleepSession } from '@trainingai/shared/types'
import { sourceRank } from '@trainingai/shared/health/source-rank'
import { aestMidnight, toAestDay, secondsSinceLocalMidnight } from '@trainingai/shared/date-utils'
import type { RollupIO } from './io'
import type { ModelRuntime } from '@/lib/oura-models/inference/runtime'

export interface RollupOptions {
  debugDate?: string
  disableNeuralStager?: boolean
  fullHistory?: boolean
  dumpOnly?: boolean
  allowStepsDecrease?: boolean
  sinceDs?: number
}

/**
 * The Oura BLE rollup: decoded ring frames in, finished health rows out.
 *
 * Runtime-agnostic on purpose (D2 Task 2) — every store it touches goes through `RollupIO`, so the
 * same computation runs on the server against Postgres and, once Task 3 lands, on the device
 * against local SQLite. Writing a second rollup for the device instead would be the exact
 * duplicate-implementation bug CLAUDE.md's One Formula, One Place rule exists to prevent.
 *
 * Extracted verbatim from `PostgresRepository.aggregateOuraRawSamples`; the extraction deliberately
 * ships no behaviour change.
 */
export async function runOuraRollup(
  io: RollupIO,
  runtime: ModelRuntime,
  timezone: string,
  opts?: RollupOptions,
): Promise<import('@/lib/data/repository').OuraRawAggregateResult> {
  const anchor = await io.readClockAnchor()
  if (!anchor) return { sleepSessions: 0, bodyMetricDays: 0, daysWritten: [], hrSeriesPoints: 0, wearDays: 0, stepErrors: [], debugNight: null }
  // Q-71: every anchor observation, not just the newest — a ds resolves against a robust
  // (p10-of-lag) offset over the whole epoch (Q-139), which is stable regardless of which
  // anchor happens to be newest when this runs and cannot compress like interpolation would
  // (see lib/oura-ble/clock.ts). `anchor` (singular, above) stays in use below for internal
  // cutoff/window-matching bounds only — those don't need display-precision timestamps.
  const anchors = await io.readClockAnchors()

  // Incremental window (review C-1/H-2): the ingest rollup only recomputes the recent tail — the
  // ring's history only moves forward, so older days re-derive to identical, already-persisted
  // values. 35 days comfortably covers every internal look-back (14d HR series, 21d resilience,
  // recent nights) with margin. `fullHistory` (redecode / an explicit debug night) removes the
  // bound and reprocesses everything. The daily-summary baseline fold is seeded from the persisted
  // checkpoint before the window, so bounded reads still produce byte-identical baselines/nHistory.
  // `dumpOnly` is the lightweight debug-dump path: a debugDate normally forces fullHistory (an old
  // date may sit outside the window), but reprocessing all history for a *recent* night times the
  // request out at the gateway ("upstream error"). dumpOnly keeps the 35-day bound, so a recent
  // night's dump stays fast; older-than-35d dumps simply return no night.
  const fullHistory = opts?.fullHistory === true || (opts?.debugDate != null && opts?.dumpOnly !== true)
  const ROLLUP_WINDOW_DAYS = 35
  const DS_PER_DAY = 24 * 3600 * 10
  // `sinceDs` narrows the 35-day bound to the span a specific ingest actually touched. 35 days was
  // chosen when the table was small; at 984,862 rows against ~37 days of ring history it covers
  // essentially everything, so each run re-read and re-decoded the whole table in main-thread JS to
  // absorb a few minutes of new data. Runs then outlasted the gap between BLE syncs and went
  // back-to-back, pegging the single Node thread for 15–30 minutes at a time — which starved every
  // other request on the process, including ones touching no database (Q-213).
  //
  // The 3-day margin is not arbitrary: `summaryFloorDate` below already discards nights within
  // 2 days of the cutoff as possibly-truncated, so the window must start ≥2 days before the first
  // night we intend to rewrite, and a sleep window can open the calendar day before it ends. The
  // caller only passes `sinceDs` once it has seen a full-window pass complete in this process, so a
  // cold start still re-derives the whole window and cannot inherit a gap from before it started.
  // No `sinceDs` from the caller does NOT mean "re-derive everything". A fresh process has no
  // in-memory span, and re-deriving the 35-day window to cover that gap cost six minutes of a
  // pegged main thread on every deploy, measured in production. The persisted watermark says how
  // far the last successful run reached, so a cold start narrows from there like a warm one.
  // Null (no row, or a row from a previous clock epoch) still falls back to the full window.
  const persistedSinceDs = fullHistory ? null
    : await io.readRollupWatermark(currentEpoch(anchors) ?? 0)
  // The run must cover BOTH: everything since the last successful rollup (the watermark) and
  // whatever this batch carried. Taking the caller's span alone was wrong — a batch ingested before
  // a restart, after the last rollup, sits older than the incoming batch's span and would never be
  // rolled up. Normally the watermark is the older of the two and wins; the caller's span wins only
  // when a batch back-fills data older than the watermark. Either way, the minimum is the safe floor.
  const spans = [opts?.sinceDs, persistedSinceDs].filter((v): v is number => v != null)
  const effectiveSinceDs = spans.length > 0 ? Math.min(...spans) : null
  const incrementalFloorDs = effectiveSinceDs != null ? effectiveSinceDs - 3 * DS_PER_DAY : null
  const windowFloorDs = anchor.anchorDs - ROLLUP_WINDOW_DAYS * DS_PER_DAY
  const rollupCutoffDs = fullHistory ? null
    : incrementalFloorDs != null ? Math.max(windowFloorDs, incrementalFloorDs)
    : windowFloorDs
  let debugNight: import('@/lib/data/repository').SleepNightDebug | null = null
  // Longest matching window captured so far — several windows can share a wake-day (the real
  // overnight plus an evening rest fragment), and the diagnostic must show the main night, not
  // whichever window happened to be processed last.
  let debugWindowDs = -1
  // The authoritative ds→wall-clock conversion for everything this rollup writes (sleep
  // session start/end, HR series timestamps, temperature samples, dayForDs). Falls back to
  // the single-newest-anchor extrapolation only if resolveDsToMs somehow finds no anchor in
  // the current epoch — cannot happen given `anchor` above already proved one exists, kept as
  // a defensive floor rather than a silent throw.
  const toDate = (ds: number) => {
    const ms = resolveDsToMs(ds, anchors)
    return new Date(ms ?? measuredAtMs(ds, anchor.anchorDs, anchor.anchorUtc.getTime()))
  }

  // Decode from the archival body_hex when the persisted `decoded` JSONB is absent
  // (Lever 1: ingest no longer stores `decoded` — it's re-derivable from body_hex).
  // Historical rows still carry `decoded`, so coalesce: use it when present, else
  // decode the hex in-memory. Rows that decode to null (unknown/malformed) drop out,
  // preserving the old isNotNull(decoded) filter's semantics.
  // Single-connection read (BLE pool-starvation fix): fetch every tag this rollup needs
  // in ONE query, then partition in memory by tag. The previous 10-way Promise.all of
  // rowsByTags checked out up to 10 pooled connections at once, so a single slow ingest
  // aggregation could monopolise the whole pool (max:10) and starve every other request
  // — including the outbox sync push/pull — of a connection. The tag lists are disjoint,
  // so the partition is exact and each result array stays ds-ordered (the base query is).
  const ROLLUP_TAGS = [0x76, 0x4b, 0x4e, 0x5a, 0x80, 0x60, 0x5d, 0x6f, 0x8b, 0x86, 0x46, 0x69, 0x72, 0x75, 0x50]
  const rollupRows = await (async () => {
    const raw = await io.readRawFrames({ tags: ROLLUP_TAGS, startDs: rollupCutoffDs })
    return raw
      .map(r => ({ ds: r.ds, tag: r.tag, decoded: r.decoded ?? (r.bodyHex ? decodeEventBody(r.tag, hexToBytes(r.bodyHex)) : null) }))
      .filter((r): r is { ds: number; tag: number; decoded: Record<string, unknown> } => r.decoded != null)
  })()
  const rowsByTags = (tags: number[]) => {
    const set = new Set(tags)
    return rollupRows.filter(r => set.has(r.tag))
  }

  const bedtimes    = rowsByTags([0x76])
  const phaseRows   = rowsByTags([0x4b, 0x4e, 0x5a])
  const ibiRows     = rowsByTags([0x80, 0x60])
  const hrvRows     = rowsByTags([0x5d])
  const spo2Rows    = rowsByTags([0x6f])
  const spo2RPiRows = rowsByTags([0x8b])
  const aohrRows    = rowsByTags([0x86])
  const tempRows    = rowsByTags([0x46, 0x69])
  const sleepSignal = rowsByTags([0x72, 0x75])
  const metRows     = rowsByTags([0x50])


  const MIN_BEDTIME_DS = 3 * 3600 * 10  // a real night is hours; ignore sub-period fragments
  const MAX_SLEEP_DS = 16 * 3600 * 10   // cap one window so contamination can't span the day

  // bedtime_period (0x76) is NOT a nightly window on this Ring 5 — the captured events are
  // ~0.5h sub-period FRAGMENTS (e.g. 01:23–01:53), not the full night (confirmed on-device
  // 2026-07-09: duration_hours 0.5). Treating them as sleep windows produced tiny/duplicate
  // sleep rows and blew displayed end times into the afternoon. Only accept a bedtime window
  // if it's a plausible full night (>= MIN_BEDTIME_DS); otherwise ignore it and cluster.
  const windows = new Map<number, { startDs: number; endDs: number }>()
  for (const b of bedtimes) {
    const d = b.decoded as Record<string, unknown>
    const startDs = Number(d.bedtime_start_ds)
    let endDs = Number(d.bedtime_end_ds)
    if (!Number.isFinite(startDs) || !Number.isFinite(endDs) || endDs - startDs < MIN_BEDTIME_DS) continue
    endDs = Math.min(endDs, startDs + MAX_SLEEP_DS)
    const prev = windows.get(startDs)
    if (!prev || endDs > prev.endDs) windows.set(startDs, { startDs, endDs })
  }

  // Primary window source: cluster the ring's sleep-ONLY signals — sleep_acm_period (0x72)
  // and sleep_temp (0x75) fire only while asleep — into nights split by >2h gaps, each
  // capped at MAX_SLEEP_DS. Add a clustered night only where a kept bedtime window doesn't
  // already cover it (bedtime stays authoritative when it's a real full-night window; no
  // duplicate row for the same night). This is also why 07-09's window-scoped HRV/resting-HR
  // were blank — the night had no usable window until clustering became the primary source.
  {
    const GAP_DS = 2 * 3600 * 10      // a gap over 2h starts a new night
    const MIN_DUR_DS = 1 * 3600 * 10  // ignore clusters shorter than 1h
    const bedtimeWindows = [...windows.values()]
    const overlapsBedtime = (start: number, end: number) =>
      bedtimeWindows.some(w => start < w.endDs && end > w.startDs)
    const dsList = sleepSignal.map(r => Number(r.ds)).filter(Number.isFinite).sort((a, b) => a - b)
    let start: number | null = null
    let prev = 0
    const flush = (s: number, e: number) => {
      const end = Math.min(e, s + MAX_SLEEP_DS)
      if (end - s >= MIN_DUR_DS && !overlapsBedtime(s, end)) windows.set(s, { startDs: s, endDs: end })
    }
    for (const ds of dsList) {
      if (start === null) { start = ds; prev = ds; continue }
      if (ds - prev > GAP_DS) { flush(start, prev); start = ds }
      prev = ds
    }
    if (start !== null) flush(start, prev)
  }

  // Collapse a single night's clusters into ONE window. The ring emits several sleep-signal
  // clusters across a night (a brief wake splits them, or an early-evening still period), each
  // dated to the same wake day; the read-time merge (mergeByDate) would otherwise SUM their
  // durations — 07-09 showed a 15.7h "time asleep" (two windows added). Merge windows less than
  // MERGE_GAP_DS apart into one span (still capped at MAX_SLEEP_DS), so each night is one row.
  const MERGE_GAP_DS = 3 * 3600 * 10
  const nightWindows = [...windows.values()]
    .sort((a, b) => a.startDs - b.startDs)
    .reduce<{ startDs: number; endDs: number }[]>((acc, w) => {
      const prev = acc[acc.length - 1]
      if (prev && w.startDs - prev.endDs < MERGE_GAP_DS) {
        prev.endDs = Math.min(Math.max(prev.endDs, w.endDs), prev.startDs + MAX_SLEEP_DS)
      } else {
        acc.push({ startDs: w.startDs, endDs: Math.min(w.endDs, w.startDs + MAX_SLEEP_DS) })
      }
      return acc
    }, [])
    // When windowing, drop any night that could be TRUNCATED by the read cutoff — a night whose
    // raw data began before the cutoff would be missing its early hours and re-derive to a wrong
    // (shorter) row. Keep only nights fully clear of the boundary (their prior-run rows, already
    // persisted, stay correct). The baseline fold is seeded from the persisted checkpoint before
    // the earliest KEPT night, so those skipped boundary nights still count toward the baselines.
    .filter(w => rollupCutoffDs == null || w.startDs >= rollupCutoffDs + MAX_SLEEP_DS)

  const sleepRows: import('@/lib/data/repository').OuraSleepUpsertRow[] = []
  const nightInputsByDate = new Map<string, NightInput>()
  // One entry per sleep WINDOW; collapsed into one NightInput per night below.
  const nightCandidates: { sleepStart: Date; sleepEnd: Date; durationHours: number | null; input: NightInput }[] = []
  const bdiByDate = new Map<string, number>()
  // Raw per-night signals for the chronic-stress model (the granular data not captured in the
  // DailySummaryRow). Populated in the night loop; consumed by the chronic_stress step below.
  const chronicStressSignalsByDate = new Map<string, ChronicStressNightSignals>()
  for (const w of nightWindows) {
    // Tighten the window to the span the ring was actually sleep-sensing, by HR-sample density
    // per 5-min epoch. The window (bedtime event / 0x72/0x75 cluster) can lead real sleep by hours:
    // the ring spot-checks HR (a few beats/epoch) and can briefly wake its sensors during evening
    // wind-down, but only streams DENSE continuous HR (hundreds/epoch) while asleep. Keep only the
    // longest dense run — an isolated evening burst drops out (2026-07-14 & 07-15 dumps: bedtime was
    // shown ~1.5–2h early, time-asleep inflated). No-op when there's no HR at all, so a real night
    // is never trimmed to nothing.
    {
      const CLAMP_EPOCH_DS = 5 * 60 * 10
      const winEpochs = Math.max(1, Math.ceil((w.endDs - w.startDs) / CLAMP_EPOCH_DS))
      const perEpochBeats = new Array<number>(winEpochs).fill(0)
      for (const r of ibiRows) {
        const ds = Number(r.ds)
        if (ds < w.startDs || ds > w.endDs) continue
        const e = Math.min(winEpochs - 1, Math.floor((ds - w.startDs) / CLAMP_EPOCH_DS))
        perEpochBeats[e] += numArr(r.decoded, 'hr_bpm').filter(v => v >= 35 && v <= 150).length
      }
      const clamped = clampToDenseSensing(w, perEpochBeats, CLAMP_EPOCH_DS)
      w.startDs = clamped.startDs
      w.endDs = clamped.endDs
    }

    const inWindow = <T extends { ds: number }>(rows: T[], slackDs = 0) =>
      rows.filter(r => Number(r.ds) >= w.startDs && Number(r.ds) <= w.endDs + slackDs)

    // Hypnogram: 30-second 2-bit codes (skill §8); phase events are emitted by
    // the on-ring analysis so allow them to be timestamped up to 6h after wake.
    // Consolidate from a SINGLE tag among 0x4b/0x4e/0x5a: their byte semantics
    // aren't pinned to a captured Ring-5 vector yet, and if the three carry
    // redundant copies of the same hypnogram, concatenating all three would
    // triple-count. Pick the tag with the longest in-window code sequence (the
    // real per-epoch stream is longest; self-corrects regardless of which tag it
    // is) and use it for both the stage hours and the 5-min string so they agree.
    // PROVISIONAL until an on-device capture validates it — see
    // docs/oura-ble-sleep-staging-findings.md. Dormant today (no phase events).
    const phasesByTag = new Map<number, string[]>()
    for (const p of inWindow(phaseRows, 6 * 36000)) {
      const arr = (p.decoded as Record<string, unknown>)?.phases
      if (!Array.isArray(arr)) continue
      const list = phasesByTag.get(Number(p.tag)) ?? []
      list.push(...(arr as string[]))
      phasesByTag.set(Number(p.tag), list)
    }
    let phases: string[] = []
    for (const list of phasesByTag.values()) if (list.length > phases.length) phases = list
    const count = (name: string) => phases.filter(p => p === name).length
    const hrs = (n: number) => Math.round((n * 30 / 3600) * 100) / 100
    const deepH = hrs(count('deep'))
    const remH = hrs(count('rem'))
    const lightH = hrs(count('light'))
    const awakeH = hrs(count('awake'))
    const totalSleepH = Math.round((deepH + remH + lightH) * 100) / 100

    // HRV, resting HR and average HR all come from `@trainingai/shared/health/night-vitals` —
    // one implementation, shared with the on-device rollup (Q-29 / D2 Task 5) so the phone and
    // the server can never disagree about what the night's numbers were. The definitions those
    // functions pin (median-gated 0x5d for HRV, lowest 5-min BIN AVERAGE for resting HR, one MET
    // exclusion feeding both) are documented at the top of that module.
    const metExclusion: ExclusionWindow[] = metExclusionWindows(inWindow(metRows))
    const nightHr = nightlyHeartRate(inWindow(ibiRows), metExclusion)
    const restingHr = nightHr.restingHrBpm
    // Extracted once: the headline median and the chronic-stress model's raw list must be the
    // same samples, not two passes that could gate differently.
    const nightRmssd = rmssdSamples(inWindow(hrvRows))
    const timeInBedH = Math.round(((w.endDs - w.startDs) / 36000) * 100) / 100

    // Own hypnogram: the Ring 5 emits no phase events, so when `phases` is empty we stage
    // the night ourselves from movement (0x72 acm_mad) + HR (IBI) + HRV (0x5d) + temp,
    // binned into 5-min epochs (lib/health/sleep-staging — heuristic, see the plan doc).
    // Ring phase events, if they ever arrive, still take precedence.
    const EPOCH_DS = 5 * 60 * 10
    let modelStages: SleepStage[] = []
    // Raw timestamped HR samples (seconds since window start) — used to refine onset latency
    // below the 5-min epoch grid, back to the ring's deciseconds resolution.
    const onsetSamples: OnsetSample[] = []
    let modelOnsetSec: number | null = null
    let foldedWakeBouts = 0
    // BDI (breathing-disturbance index) from SleepNet's apnea head — a free byproduct of the
    // staging pass, null on heuristic-fallback nights (no neural apnea head).
    let sleepNetBdi: number | null = null
    let respiratoryRate: number | null = null
    if (phases.length === 0) {
      const nEpochs = Math.max(1, Math.ceil((w.endDs - w.startDs) / EPOCH_DS))
      const acc = Array.from({ length: nEpochs }, () => ({ mv: [] as number[], hr: [] as number[], hv: [] as number[], tp: [] as number[], ibi: [] as number[], sp: [] as number[] }))
      const binOf = (ds: number) => Math.min(nEpochs - 1, Math.max(0, Math.floor((ds - w.startDs) / EPOCH_DS)))
      for (const r of inWindow(sleepSignal)) {
        const b = acc[binOf(Number(r.ds))]
        if (Number(r.tag) === 0x72) { const a = numArr(r.decoded, 'acm_mad'); if (a.length) b.mv.push(a.reduce((x, y) => x + y, 0) / a.length) }
        else b.tp.push(...numArr(r.decoded, 'temps_c')) // 0x75 sleep_temp
      }
      for (const r of inWindow(tempRows)) acc[binOf(Number(r.ds))].tp.push(...numArr(r.decoded, 'temps_c'))
      for (const r of inWindow(ibiRows)) {
        const tSec = (Number(r.ds) - w.startDs) / 10
        const b = acc[binOf(Number(r.ds))]
        for (const v of numArr(r.decoded, 'hr_bpm')) if (v >= 35 && v <= 150) { b.hr.push(v); onsetSamples.push({ tSec, hr: v }) }
        // Raw IBI (ms) for the breathing-rate signal — the tachogram carries the respiratory
        // oscillation that discriminates REM (irregular) from deep (regular).
        b.ibi.push(...numArr(r.decoded, 'ibi_ms'))
      }
      for (const r of inWindow(hrvRows)) acc[binOf(Number(r.ds))].hv.push(...numArr(r.decoded, 'rmssd_ms').filter(v => v > 0))
      // Per-epoch SpO₂ samples for the stager's spo2Var term. Same source precedence as the
      // SleepNet input below and the body_metrics rollup: the firmware percentage (0x6f) when the
      // ring emits any, else derived from raw R (0x8b) — the Ring 5 only ever emits the latter.
      {
        const firmware = inWindow(spo2Rows).map(r => ({ ds: Number(r.ds), v: numArr(r.decoded, 'spo2_percent') }))
        const source = firmware.some(r => r.v.length)
          ? firmware
          : inWindow(spo2RPiRows).map(r => ({
              ds: Number(r.ds),
              v: numArr(r.decoded, 'r').map(spo2PctFromR).filter((x): x is number => x !== null),
            }))
        // Range-filtering is spo2VariabilityFromSamples's job, not this loop's — one place decides
        // what a plausible reading is.
        for (const r of source) acc[binOf(r.ds)].sp.push(...r.v)
      }
      const avg = (xs: number[]) => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null
      // Within-epoch HR spread (SD of the epoch's beats) — a REM-vs-deep signal the 5-min mean
      // hides. Needs enough beats to be meaningful, else left null (neutral in the stager).
      const std = (xs: number[]) => { const m = avg(xs); return m == null || xs.length < 5 ? null : Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length) }
      const breath = acc.map(b => breathingFromIbi(b.ibi))
      const epochs: SleepEpoch[] = acc.map((b, i) => ({ movement: avg(b.mv), hr: avg(b.hr), hrv: avg(b.hv), temp: avg(b.tp), hrVar: std(b.hr), breathVar: breath[i].variability, lfhf: lfhfFromIbi(b.ibi).lfhf, spo2Var: spo2VariabilityFromSamples(b.sp) }))
      // Night respiratory rate: median of per-epoch breaths/min (Task 2.1) — reused
      // from the same breathingFromIbi call that already feeds the stager's breathVar.
      const epochRates = breath.map(x => x.rateBrpm).filter((r): r is number => r != null)
      respiratoryRate = epochRates.length >= 6
        ? [...epochRates].sort((a, b) => a - b)[Math.floor(epochRates.length / 2)]
        : null
      const staging = stageSleepDetailed(epochs)
      modelStages = staging.stages
      foldedWakeBouts = staging.foldedWakeBouts
      if (modelStages.length > 0) modelOnsetSec = refineOnsetLatencySec(staging, onsetSamples)

      // Assemble the SleepNet inputs once (used for both the neural stager and the admin dump).
      const msOf = (ds: number) => toDate(ds).getTime()
      const snInput: SleepNetAssembleInput = {
        bedtimeStartMs: msOf(w.startDs),
        bedtimeEndMs: msOf(w.endDs),
        ibiRows: inWindow(ibiRows).map(r => ({
          tsMs: msOf(Number(r.ds)),
          ibiMs: numArr(r.decoded, 'ibi_ms'),
          quality: numArr(r.decoded, 'quality'),
        })),
        motionRows: inWindow(sleepSignal)
          .filter(r => Number(r.tag) === 0x72)
          .map(r => {
            const a = numArr(r.decoded, 'acm_mad')
            return { tsMs: msOf(Number(r.ds)), acmMad: a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0 }
          }),
        // SpO₂ high-res channel: the Ring 5 emits only raw R/PI (0x8b), never the
        // firmware % (0x6f), so feed the derived % (spo2PctFromR) when no firmware
        // sample is present — same source-precedence as the body_metrics rollup below.
        spo2Rows: (() => {
          const firmware = inWindow(spo2Rows).map(r => ({
            tsMs: msOf(Number(r.ds)),
            spo2: numArr(r.decoded, 'spo2_percent').filter(v => v >= 70 && v <= 100),
          }))
          if (firmware.some(r => r.spo2.length)) return firmware
          return inWindow(spo2RPiRows).map(r => ({
            tsMs: msOf(Number(r.ds)),
            spo2: numArr(r.decoded, 'r').map(spo2PctFromR).filter((v): v is number => v !== null),
          }))
        })(),
      }
      // Neural stager: Oura's SleepNet model over the assembled night. When it runs, its
      // hypnogram (5-min, aligned to the heuristic grid) replaces the heuristic stages —
      // validated REM-accurate vs the heuristic on real nights. The heuristic stays the
      // automatic fallback for nights where inference/preprocess can't run. Never throws.
      // `disableNeuralStager` forces the heuristic (used by heuristic-behaviour unit tests,
      // whose synthetic fixtures aren't realistic nights for the neural model).
      if (!opts?.disableNeuralStager) {
        try {
          const sn = await sleepNetStages5Min(snInput, modelStages.length, runtime)
          if (sn && sn.stages.length === modelStages.length) {
            modelStages = sn.stages
            foldedWakeBouts = 0
            const firstSleep = sn.stages.findIndex(s => s !== 'awake')
            modelOnsetSec = firstSleep > 0 ? firstSleep * EPOCH_MIN * 60 : 0
            sleepNetBdi = sn.bdi.perHour
          }
        } catch (err) {
          console.error('[oura-ble] SleepNet staging failed, using heuristic:', err)
        }
      }

      // Diagnostic capture: per-epoch view of what the stager saw/decided for one requested
      // night, so the onset trim / wake detection / REM signal can be tuned against real data.
      if (opts?.debugDate && toAestDay(toDate(w.endDs), timezone) === opts.debugDate && w.endDs - w.startDs > debugWindowDs) {
        debugWindowDs = w.endDs - w.startDs
        const r1 = (x: number | null) => (x == null ? null : Math.round(x * 10) / 10)
        debugNight = {
          date: opts.debugDate,
          windowStart: formatInTimeZone(toDate(w.startDs), timezone, 'HH:mm'),
          windowEnd: formatInTimeZone(toDate(w.endDs), timezone, 'HH:mm'),
          settleHr: r1(staging.settleHr),
          onsetEpoch: staging.onsetEpoch,
          epochs: epochs.map((e, i) => ({
            epoch: i,
            time: formatInTimeZone(toDate(w.startDs + i * EPOCH_DS), timezone, 'HH:mm'),
            hr: r1(e.hr),
            beats: acc[i].hr.length,
            movement: r1(e.movement),
            hrv: r1(e.hrv),
            hrVar: r1(e.hrVar ?? null),
            breathVar: r1(e.breathVar ?? null),
            lfhf: r1(e.lfhf ?? null),
            spo2Var: r1(e.spo2Var ?? null),
            stage: modelStages[i],
          })),
        }
        // Neural SleepNet dump for the same night — assemble the raw-night from decoded rows and
        // run the model (admin device-validation harness; does NOT affect the staging written
        // above). Never throw: a dump failure must not break the re-aggregate.
        try {
          debugNight.sleepNet = await sleepNetDump(snInput, runtime)
        } catch (err) {
          debugNight.sleepNet = null
          console.error('[oura-ble] sleepNet dump failed:', err)
        }
      }
    }
    const model = phases.length === 0 && modelStages.length > 0 ? summarizeSleepStages(modelStages, EPOCH_MIN, foldedWakeBouts) : null
    const hOf = (min: number) => Math.round((min / 60) * 100) / 100

    const durationHours = phases.length > 0 ? totalSleepH : model ? hOf(model.timeAsleepMin) : timeInBedH
    const deepSleepHours = phases.length > 0 ? deepH : model ? hOf(model.deepMin) : null
    const remSleepHours = phases.length > 0 ? remH : model ? hOf(model.remMin) : null
    const efficiency = phases.length > 0 ? (timeInBedH > 0 ? Math.min(100, Math.round((totalSleepH / timeInBedH) * 100)) : null) : model?.efficiencyPct ?? null
    const restlessPeriods = model ? model.awakenings : null
    const averageHrvMs = hrvMsFromSamples(nightRmssd, metExclusion)
    const avgHeartRate = nightHr.averageHrBpm
    const wakeDate = toAestDay(toDate(w.endDs), timezone)
    // A wake-day may see two windows (main night + evening fragment); keep the last non-null BDI,
    // matching the last-window-wins semantics of nightInputsByDate below.
    if (sleepNetBdi != null) bdiByDate.set(wakeDate, sleepNetBdi)

    sleepRows.push({
      ouraId: `ble:${w.startDs}`,
      date: wakeDate,
      sleepStart: toDate(w.startDs),
      sleepEnd: toDate(w.endDs),
      // Stages: ring phase events (0x4b/0x4e/0x5a) when present, else our own heuristic
      // stager over the night's raw signals, else (no signal) the window span for duration.
      durationHours,
      deepSleepHours,
      remSleepHours,
      lightSleepHours: phases.length > 0 ? lightH : model ? hOf(model.lightMin) : null,
      awakHours: phases.length > 0 ? awakeH : model ? hOf(model.awakeMin) : null,
      // The 5-min hypnogram string the Health sleep ribbon renders.
      sleepPhase5Min: phases.length > 0 ? phasesToPhase5Min(phases) : model ? stagesToPhase5Min(modelStages) : null,
      efficiency,
      onsetLatencySec: modelOnsetSec,
      restlessPeriods,
      averageHrvMs,
      avgHeartRate,
      lowestHeartRate: restingHr,
      timeInBedHours: timeInBedH,
      respiratoryRate,
    })

    // Nightly temperature (ported open_oura algorithm — chronologically ordered
    // raw skin-temp samples across the whole night, in centi-degC).
    //
    // 0x75 (sleep_temp) only, one sample per frame. Two separate corrections:
    //   - Frames were flattened probe-by-probe, so simultaneous readings were fed to a
    //     temporal pipeline as if consecutive. temperatureFrameSeries collapses each
    //     frame to one value (and gives it one timestamp instead of N duplicates).
    //   - 0x46/0x69 are dropped. Their middle value sits on an exact 0.5 degC grid in
    //     98.3% of 30k rows, so any collapse inherits that quantisation: over 21 nights
    //     19 landed on exact whole degrees, leaving tempZ and the readiness temperature
    //     contributor with no discriminative power. 0x75 also fires only while asleep,
    //     which is the algorithm's domain.
    // Empirical, not protocol — the decoder shares one format across all three tags and
    // which stream the ring itself consumes is not answerable from open_oura.
    const tempSamples = temperatureFrameSeries(
      inWindow(sleepSignal)
        .filter(r => Number(r.tag) === 0x75)
        .map(r => ({ ds: Number(r.ds), tempsC: numArr(r.decoded, 'temps_c') })),
    )
    const nightlyCenti = tempSamples.length > 0 ? nightlyTemperatureCentiC(tempSamples.map(t => t.centi)) : null
    const tempMeanC = nightlyCenti != null ? nightlyCenti / 100 : null

    // Recovery Index: overnight HR bin averages -> hours between the smoothed
    // minimum and wake (lib/health/recovery-index.ts; reuses the resting-HR bins
    // already computed above).
    const hrSeriesForRecovery = nightHr.bins.map(b => ({ timestamp: toDate(b.bin * HR_BIN_DS), bpm: b.averageBpm }))
    const recovery = computeRecoveryIndex({ hrSeries: hrSeriesForRecovery, wakeTime: toDate(w.endDs) })

    // A night can produce two windows sharing a wake-day (main night + an
    // evening fragment). Collected per WINDOW here and resolved into one row per night after the
    // loop via the shared circadian grouping (lib/health/sleep-night.ts) — the old last-window-wins
    // `.set()` let an evening nap overwrite the night and then fed that into the checkpointed EMA
    // baselines, which is audit finding Q-1.
    nightCandidates.push({
      sleepStart: toDate(w.startDs),
      sleepEnd: toDate(w.endDs),
      durationHours,
      input: {
      date: wakeDate,
      sleepDurationHours: durationHours,
      sleepEfficiency: efficiency,
      deepSleepHours,
      remSleepHours,
      restlessPeriods,
      sleepLatencySec: modelOnsetSec,
      hrvAvgMs: averageHrvMs,
      rhrLowBpm: restingHr,
      rhrAvgBpm: avgHeartRate,
      recoveryIndexHours: recovery?.hoursToSettle ?? null,
      tempMeanC,
      metAvg: null, // filled in below from calendar-day MET frames
      breathAvgRpm: respiratoryRate, // same value written to sleep_sessions.respiratory_rate
      },
    })

    // Stash the granular raw signals the chronic-stress model needs but the DailySummaryRow does
    // not carry (30-sec hypnogram, per-5-min HRV, skin-temp samples, bedtime). Consumed by the
    // chronic_stress step below. The 30-sec hypnogram is up-sampled 10× from the 5-min stager
    // output (the Ring 5 emits no native 30-sec phase events — GAP 1 fallback (b); this makes SFI
    // transition-counting coarser, noted as a Known-Issue).
    const phase5MinStr = phases.length > 0 ? phasesToPhase5Min(phases) : model ? stagesToPhase5Min(modelStages) : ''
    const sleepPhase30Sec: number[] = []
    for (const ch of phase5MinStr) {
      const code = Number(ch)
      for (let k = 0; k < 10; k++) sleepPhase30Sec.push(code)
    }
    const ibi5MinEvents = inWindow(ibiRows)
      .filter(r => Number(r.tag) === 0x80)
      .map(r => ({ startMs: toDate(Number(r.ds)).getTime(), ibiMs: numArr(r.decoded, 'ibi_ms'), quality: numArr(r.decoded, 'quality') }))
    const hrv5 = computeHrv5MinSeries(ibi5MinEvents)
    const tempSkinC = tempSamples.map(t => t.centi / 100)
    chronicStressSignalsByDate.set(wakeDate, {
      sleepPhase30Sec,
      hrvItems: nightRmssd.map(s => s.value),
      hrvMedianHR5min: hrv5.hrvMedianHR5min,
      hrvQuality5min: hrv5.hrvQuality5min,
      tempSkin: tempSkinC,
      tempSkinTimestamps: tempSamples.map(t => toDate(t.ds).getTime()),
      bedtimeStart: toDate(w.startDs).getTime(),
      highestTemperature: tempSkinC.length ? Math.max(...tempSkinC) : NaN,
    })
  }
  // Resolve the per-window candidates into one row per night: naps are dropped entirely (they are
  // not sleep-baseline material — their HRV/HR are measured awake) and a night broken by a wake-up
  // is reassembled rather than counted as two. Q-1: the previous last-window-wins `.set()` put a
  // 45-minute, zero-sleep evening fragment into 2026-07-26's baselines instead of a 7.00 h night.
  for (const period of groupSleepPeriods(nightCandidates).nights) {
    const parts = period.windows
    const durs = parts.map(p => p.durationHours ?? 0)
    const totalSleep = durs.reduce((a, b) => a + b, 0)
    const wmean = (pick: (i: NightInput) => number | null) => {
      const v = parts.map((p, i) => ({ value: pick(p.input), w: durs[i] })).filter(x => x.value != null && x.w > 0)
      const wsum = v.reduce((a, b) => a + b.w, 0)
      return wsum > 0 ? v.reduce((a, b) => a + b.value! * b.w, 0) / wsum : null
    }
    const nsum = (pick: (i: NightInput) => number | null) => {
      const v = parts.map(p => pick(p.input)).filter((x): x is number => x != null)
      return v.length ? v.reduce((a, b) => a + b, 0) : null
    }
    const first = parts[0].input
    const last = parts[parts.length - 1].input
    if (parts.length === 1) { nightInputsByDate.set(period.date, { ...first, date: period.date }); continue }
    const timeInBed = (parts[parts.length - 1].sleepEnd.getTime() - parts[0].sleepStart.getTime()) / 3_600_000
    nightInputsByDate.set(period.date, {
      ...first,
      date: period.date,
      sleepDurationHours: totalSleep,
      // Recomputed across the whole period, so the wake-up gap correctly costs efficiency.
      sleepEfficiency: timeInBed > 0 ? Math.min(100, Math.round((totalSleep / timeInBed) * 100)) : null,
      deepSleepHours: nsum(i => i.deepSleepHours),
      remSleepHours: nsum(i => i.remSleepHours),
      restlessPeriods: (nsum(i => i.restlessPeriods) ?? 0) + period.gapHours.length,
      sleepLatencySec: first.sleepLatencySec,          // you fall asleep once, at the start
      hrvAvgMs: wmean(i => i.hrvAvgMs),
      rhrAvgBpm: wmean(i => i.rhrAvgBpm),
      breathAvgRpm: wmean(i => i.breathAvgRpm),
      tempMeanC: wmean(i => i.tempMeanC),
      rhrLowBpm: (() => {
        const v = parts.map(p => p.input.rhrLowBpm).filter((x): x is number => x != null)
        return v.length ? Math.min(...v) : null
      })(),
      // Hours from the overnight HR minimum to waking — a property of the final segment.
      recoveryIndexHours: last.recoveryIndexHours,
      metAvg: null,
    })
  }

  // Each write step is isolated: a failure in one (e.g. a bad sleep row) must
  // not block the others — otherwise one throwing step silently starves every
  // downstream metric (this is exactly how SpO₂ went missing in prod while HRV
  // wrote, 2026-07-08). Errors are collected and returned, never thrown.
  const stepErrors: string[] = []
  const step = async (name: string, fn: () => Promise<void>) => {
    try { await fn() } catch (err) {
      const msg = `${name}: ${err instanceof Error ? err.message : String(err)}`
      stepErrors.push(msg)
      console.error('[oura-ble] aggregate step failed —', msg)
    }
  }

  if (sleepRows.length > 0) await step('sleep', async () => {
    // Own our derived rows: delete every BLE sleep row for the wake-days we're about to
    // write, then insert the fresh set. Deleting only the reproduced oura_ids (as before)
    // orphaned rows when a night's shape changed — e.g. after clusters were merged into one
    // window, the night's SECOND old cluster row survived and mergeByDate summed it back in
    // (07-09 stuck at 15.7h on Redecode). Keying delete on the wake-day is also robust to the
    // clock anchor drifting the derived sleep_start between drains.
    const dates = Array.from(new Set(sleepRows.map(r => r.date)))
    await io.deleteBleSleepSessionsForDates(dates)
    await io.upsertSleepSessions(sleepRows)
  })

  // body_metrics per local day: HRV + RHR from each night (keyed to the wake
  // date, same as the Cloud sync), SpO₂ as the daily mean of 0x6f samples.
  const byDay = new Map<string, { date: string; hrvMs?: number; restingHeartRate?: number; spo2Pct?: number; steps?: number }>()
  // Sourced from the RESOLVED nights, not from every raw window (audit finding Q-18). Iterating
  // sleepRows was last-window-wins, so on 2026-07-26 a 45-minute evening fragment wrote
  // resting_heart_rate=73 / hrv_ms=25 over the night's real 60 / 34 — and body_metrics.
  // resting_heart_rate is the input to resolveHrProfile's 28-day mean, so one nap moved every
  // HR-zone boundary and put a false spike in two trend charts.
  for (const night of nightInputsByDate.values()) {
    if (night.hrvAvgMs == null && night.rhrLowBpm == null) continue
    const row = byDay.get(night.date) ?? { date: night.date }
    if (night.hrvAvgMs != null) row.hrvMs = night.hrvAvgMs
    if (night.rhrLowBpm != null) row.restingHeartRate = Math.round(night.rhrLowBpm)
    byDay.set(night.date, row)
  }
  // Key each SpO₂ sample to its own local calendar day. An earlier version keyed
  // via the sleep-signal window (to mirror HRV/RHR's wake-day assignment), but the
  // ring measures SpO₂ on its own schedule — samples routinely fall OUTSIDE the
  // sleep-ACM window's ds range and then orphaned entirely (prod 2026-07-08: a full
  // night's 5,783 post-midnight samples never landed on any day). Calendar-day
  // keying is robust: every sample lands somewhere. A night that straddles midnight
  // splits across two days, which is acceptable for a daily SpO₂ trend and can't
  // silently drop data.
  const dayForDs = (ds: number) => toAestDay(toDate(ds), timezone)
  const spo2ByDay = new Map<string, number[]>()
  for (const r of spo2Rows) {
    const samples = numArr(r.decoded, 'spo2_percent').filter(v => v >= 70 && v <= 100)
    if (samples.length === 0) continue
    const day = dayForDs(Number(r.ds))
    spo2ByDay.set(day, [...(spo2ByDay.get(day) ?? []), ...samples])
  }
  // The Ring 5 emits only raw R/PI (0x8b), never the firmware % (0x6f) — derive
  // an estimated % per sample via the Oura "SpO₂ Simple" quadratic. Firmware %
  // takes precedence on any day that has both.
  const spo2DerivedByDay = new Map<string, number[]>()
  for (const r of spo2RPiRows) {
    const samples = numArr(r.decoded, 'r')
      .map(spo2PctFromR)
      .filter((v): v is number => v !== null)
    if (samples.length === 0) continue
    const day = dayForDs(Number(r.ds))
    spo2DerivedByDay.set(day, [...(spo2DerivedByDay.get(day) ?? []), ...samples])
  }
  for (const [day, samples] of spo2DerivedByDay) {
    if (!spo2ByDay.has(day)) spo2ByDay.set(day, samples)
  }
  for (const [day, samples] of spo2ByDay) {
    const row = byDay.get(day) ?? { date: day }
    row.spo2Pct = Math.round((samples.reduce((a, b) => a + b, 0) / samples.length) * 10) / 10
    byDay.set(day, row)
  }

  // ── Daily steps from Oura's real `step_counter` model (D0), merged with any accurate ──
  // ── live-counted accel windows (Tier 2 — step_live_windows) ──
  // step_counter (lib/oura-ble/step-counter-pipeline.ts) is the ring's daily-steps source: the
  // 0x7e/0x7f gait features + 0x47 motion stream are run through the ported, golden-verified model
  // per local day (the retired flat-30 col14 estimate over-counted — see the D0 own-analysis plan).
  // Both raw tags are archived in body_hex, so a redecode re-runs this same path over all history.
  // Live-counted windows (accurate) still OVERRIDE the model for the span they cover
  // (mergeStepCounterWithLive — lib/health/step-estimate.ts); the model fills every other span.
  //
  // Max-merge guard (`> existingSteps`): a derived value is only offered when it beats the stored
  // count. This is deliberately KEPT — it makes the flip non-destructive (step_counter can only
  // RAISE a day's steps, giving monotonic same-day accumulation and never lowering another source
  // like Health Connect or a manual entry). The consequence: it also cannot LOWER a historical
  // flat-30 estimate already stored under source oura_ble. Correcting that inflated history
  // downward is a separate, destructive, OWNER-GATED backfill that must wait until step_counter's
  // real-day totals are confirmed sane on the S25 (the model returns 0 on sparse fixtures; its
  // on-device input-assembly correctness is unconfirmed — D0 device gate). NEW days get the honest
  // (lower) step_counter number immediately, safely.
  await step('steps', async () => {
    const [stepFrameRows, motionFrameRows, liveWindowRows] = await Promise.all([
      io.readRawFrames({ tags: [...STEP_FEATURE_TAGS], startDs: rollupCutoffDs }),
      io.readRawFrames({ tags: [STEP_MOTION_TAG], startDs: rollupCutoffDs }),
      io.readStepLiveWindows(),
    ])
    // Bucketing + per-day merge live in lib/oura-ble/step-day-buckets.ts, shared with
    // previewStepsBackfill — the preview an owner authorises a backfill from must be computed by
    // the SAME code as the write that follows it. (They were hand-copied duplicates until
    // 2026-07-28, and the midnight-split fix landed in only one of them.)
    // Every anchor observation, not just the newest: resolved via a robust per-epoch offset
    // (Q-139), not the newest-anchor extrapolation this rollup used to use everywhere; a frame
    // that still lands in the future is skipped rather than dated forward (Q-56). Reuses the
    // same `anchors` fetched above for `toDate` (Q-71) rather than re-querying the table.
    const stepsByDay = await computeStepsByDay({
      runtime,
      stepFrames: stepFrameRows,
      motionFrames: motionFrameRows,
      liveWindows: liveWindowRows,
      anchors,
      timezone,
    })
    const days = new Set(stepsByDay.keys())
    if (days.size === 0) return
    const existing = await io.readExistingSteps(Array.from(days))
    const existingSteps = new Map(existing.map(r => [r.date, r.steps ?? 0]))
    // The magnitude guard below compared raw counts with no regard for WHO wrote them, so a
    // lower-ranked source won purely by being bigger: a Health Connect total (rank 1) larger than
    // the ring's honest count kept the ring's value from ever reaching `mergeSet`, which would
    // have accepted it (rank 3 ≥ rank 1). Protecting higher-ranked sources is `mergeSet`'s job and
    // it already does it per-field; duplicating that here only inverted the ladder. The guard's
    // real remit is monotonic same-day accumulation *within* the ring's own writes, so it now
    // applies only when the stored value ranks at or above oura_ble.
    const existingStepsRank = new Map(existing.map(r =>
      [r.date, sourceRank((r.sourceMap as Record<string, string> | null)?.steps)]))
    for (const [day, mergedSteps] of stepsByDay) {
      // allowStepsDecrease (D0 historical backfill, owner-gated): skip the magnitude guard so a
      // corrected (lower) step_counter total can overwrite an old inflated flat-30-estimate value.
      // Still safe — upsertBodyMetrics(..., 'oura_ble') below applies the per-field sourceMap rank
      // merge, so a higher-ranked `manual` entry is preserved regardless of this flag.
      const guardApplies = (existingStepsRank.get(day) ?? 0) >= sourceRank('oura_ble')
      if (opts?.allowStepsDecrease === true || !guardApplies || mergedSteps > (existingSteps.get(day) ?? 0)) {
        const row = byDay.get(day) ?? { date: day }
        row.steps = mergedSteps
        byDay.set(day, row)
      }
    }
  })
  if (byDay.size > 0) await step('body_metrics', () => io.upsertBodyMetrics(Array.from(byDay.values())))

  // ── HR time series → oura_heartrate (feeds the Home/Health HR-day charts) ──
  // 5-min binned averages from IBI (0x80/0x60, sleep + daytime) and always-on
  // HR (0x86 aohr, daytime — rides on the enabled daytime-HR feature). Bin
  // timestamps derive from the movable clock anchor, so instead of upserting
  // (near-miss duplicates) the rollup owns its rows: delete source='ble' in the
  // window and re-insert. Derived + un-referenced, so delete-and-reinsert is safe.
  const HR_SERIES_BIN_DS = 5 * 60 * 10
  const HR_WORKOUT_BIN_DS = 15 * 10 // sub-minute resolution through sets and rests
  const HR_SERIES_WINDOW_DS = 14 * 24 * 3600 * 10 // charts read day views; 14d covers them
  // Clamped to the read cutoff, and that clamp is load-bearing: this block DELETES every ble row
  // from the cutoff forward and repopulates it from `ibiRows`/`aohrRows`. Those come from the
  // windowed read, so a window narrower than 14 days would delete history it no longer has the raw
  // rows to rewrite — silently destroying up to 13 days of HR series per run. Deleting exactly what
  // this pass can rebuild keeps delete-and-reinsert safe at any window size.
  const hrSeriesCutoffDs = Math.max(anchor.anchorDs - HR_SERIES_WINDOW_DS, rollupCutoffDs ?? Number.NEGATIVE_INFINITY)

  // Workout windows (±10 min) get 15-second bins so the trace resolves
  // set/rest structure; everything else stays at 5 minutes.
  const WORKOUT_PAD_MS = 10 * 60 * 1000
  const anchorUtcMsForWindows = anchor.anchorUtc.getTime()
  const workoutWindows = (await io.readWorkoutWindows(
    new Date(measuredAtMs(hrSeriesCutoffDs, anchor.anchorDs, anchorUtcMsForWindows)),
  ))
    .map(w => ({
      fromMs: w.startedAt.getTime() - WORKOUT_PAD_MS,
      toMs: (w.completedAt ?? new Date(w.startedAt.getTime() + 2 * 3600 * 1000)).getTime() + WORKOUT_PAD_MS,
    }))
  const inWorkout = (ds: number) => {
    const ms = measuredAtMs(ds, anchor.anchorDs, anchorUtcMsForWindows)
    return workoutWindows.some(w => ms >= w.fromMs && ms <= w.toMs)
  }

  const hrSeriesBins = new Map<string, { sum: number; n: number; binStart: number }>()
  const addHrSample = (ds: number, v: number) => {
    if (v < 35 || v > 200) return // wider than the resting band — workouts are real data here
    const binDs = inWorkout(ds) ? HR_WORKOUT_BIN_DS : HR_SERIES_BIN_DS
    const binStart = Math.floor(ds / binDs) * binDs
    // Keyed on (binDs, binStart), not binStart alone: HR_SERIES_BIN_DS (3000) is a multiple
    // of HR_WORKOUT_BIN_DS (150), so a workout bin and a series bin can share a boundary and
    // silently merge into one entry, with an arbitrary bin width winning.
    const key = `${binDs}:${binStart}`
    const b = hrSeriesBins.get(key) ?? { sum: 0, n: 0, binStart }
    b.sum += v; b.n += 1
    hrSeriesBins.set(key, b)
  }
  for (const r of ibiRows) {
    if (Number(r.ds) < hrSeriesCutoffDs) continue
    for (const v of numArr(r.decoded, 'hr_bpm')) addHrSample(Number(r.ds), v)
  }
  for (const r of aohrRows) {
    if (Number(r.ds) < hrSeriesCutoffDs) continue
    for (const v of numArr(r.decoded, 'bpm')) addHrSample(Number(r.ds), v)
  }
  // Two different-width bins can still land on the same wall-clock timestamp at an aligned
  // boundary (rare) — the (user_id, timestamp) unique constraint on oura_heartrate means the
  // final rows must be one-per-timestamp, so merge by timestamp here rather than let a
  // duplicate reach the upsert (which throws "affect row a second time" inside one batch).
  const hrByTimestamp = new Map<number, { sum: number; n: number }>()
  for (const b of hrSeriesBins.values()) {
    const acc = hrByTimestamp.get(b.binStart) ?? { sum: 0, n: 0 }
    acc.sum += b.sum; acc.n += b.n
    hrByTimestamp.set(b.binStart, acc)
  }
  const hrSeriesRows = Array.from(hrByTimestamp.entries()).map(([binStart, b]) => ({
    timestamp: toDate(binStart),
    bpm: Math.round(b.sum / b.n),
    source: 'ble',
  }))
  if (hrSeriesRows.length > 0) {
    await step('hr_series', async () => {
      await io.deleteBleHeartrateFrom(toDate(hrSeriesCutoffDs))
      await io.upsertHeartrate(hrSeriesRows)
      // The zone-minutes cache is derived from these HR rows; drop the cached days we just
      // rewrote so they recompute on the next read (J-1/C-5 — owns-its-rows invalidation).
      await io.deleteZoneMinutesFrom(dayForDs(hrSeriesCutoffDs))
    })
  }

  // ── Wear time → oura_daily.non_wear_time_sec (feeds the wear-time trend chart
  // and the wear-confidence gating). Worn 15-min bins = any on-finger-only signal
  // (IBI/HRV/SpO₂/sleep/aohr) or a skin-range temperature; ambient-range temps
  // (ring on the desk/charger) don't count.
  const WEAR_BIN_DS = 15 * 60 * 10
  const wornBinsByDay = new Map<string, Set<number>>()
  const markWorn = (ds: number) => {
    const day = toAestDay(toDate(ds), timezone)
    const set = wornBinsByDay.get(day) ?? new Set<number>()
    set.add(Math.floor(ds / WEAR_BIN_DS))
    wornBinsByDay.set(day, set)
  }
  for (const rows of [ibiRows, hrvRows, spo2Rows, spo2RPiRows, phaseRows, sleepSignal, aohrRows]) {
    for (const r of rows) markWorn(Number(r.ds))
  }
  for (const r of tempRows) {
    if (numArr(r.decoded, 'temps_c').some(t => t >= 31)) markWorn(Number(r.ds))
  }
  const todayStr = toAestDay(new Date(), timezone)
  const elapsedTodaySec = secondsSinceLocalMidnight(timezone)
  const wearRows = Array.from(wornBinsByDay.entries()).map(([date, bins]) => {
    const wornSec = bins.size * (WEAR_BIN_DS / 10)
    // Mirror the Cloud's cumulative semantics: today is a partial day, so
    // non-wear counts only elapsed-and-not-worn time (grows through the day).
    const dayLenSec = date === todayStr ? elapsedTodaySec : 86400
    return { date, nonWearTimeSec: Math.round(Math.min(86400, Math.max(0, dayLenSec - wornSec))) }
  })
  if (wearRows.length > 0) await step('wear', () => io.upsertOuraDaily(wearRows))

  // ── Daily summary + rolling personal baselines (Oura BLE Phase 5 addendum A3) ──
  // MET averaged by calendar day (activity_information, 0x50) — a whole-day signal,
  // unlike the sleep-window-scoped fields above, so it's keyed separately and merged
  // into whichever nights already exist for that wake date.
  const metByDay = new Map<string, number[]>()
  for (const r of metRows) {
    const mets = numArr(r.decoded, 'met')
    if (mets.length === 0) continue
    const day = dayForDs(Number(r.ds))
    metByDay.set(day, [...(metByDay.get(day) ?? []), ...mets])
  }
  for (const [day, mets] of metByDay) {
    const night = nightInputsByDate.get(day)
    const metAvg = mets.reduce((a, b) => a + b, 0) / mets.length
    if (night) night.metAvg = metAvg
    // A MET-only day (no sleep window found) still gets a summary row so the
    // baseline isn't silently gapped — every other field is null for it.
    else nightInputsByDate.set(day, {
      date: day, sleepDurationHours: null, sleepEfficiency: null, deepSleepHours: null,
      remSleepHours: null, restlessPeriods: null, sleepLatencySec: null, hrvAvgMs: null,
      rhrLowBpm: null, rhrAvgBpm: null, recoveryIndexHours: null, tempMeanC: null, metAvg,
      breathAvgRpm: null,
    })
  }
  // Drop any night whose data could be truncated by the read cutoff (a night/MET-day within ~2
  // days of the boundary may be missing early frames → a wrong row that would poison the EMA fold
  // from there forward). Those boundary days keep their already-correct persisted rows; the fold is
  // seeded from the persisted checkpoint before the first KEPT night, so they still count.
  const summaryFloorDate = rollupCutoffDs == null ? null
    : toAestDay(toDate(rollupCutoffDs + 2 * 24 * 3600 * 10), timezone)
  if (nightInputsByDate.size > 0) {
    const nights = Array.from(nightInputsByDate.values())
      .filter(n => summaryFloorDate == null || n.date >= summaryFloorDate)
      .sort((a, b) => a.date.localeCompare(b.date))
  if (nights.length > 0) {
    // Resume the EMA baseline fold from the persisted checkpoint before the window (byte-identical
    // to a full replay — see computeDailySummaries/DailySummarySeed). null when windowing off or no
    // prior row (new user), in which case the fold cold-starts over `nights` exactly as before.
    const seedRow = fullHistory ? null : await io.readLatestDailySummaryBefore(nights[0].date)
    const seed = seedRow ? {
      hrvBaseline: seedRow.hrvBaseline, rhrBaseline: seedRow.rhrBaseline, tempBaseline: seedRow.tempBaseline,
      sleepBaseline: seedRow.sleepBaseline, metBaseline: seedRow.metBaseline, breathBaseline: seedRow.breathBaseline,
      nHistory: seedRow.nHistory,
    } : null
    const summaryRows = computeDailySummaries(nights, seed)
    await step('daily_summary', async () => {
      // Windowed path upserts only the recomputed days (older rows + their baseline checkpoints
      // untouched); full-history path replaces the whole table.
      if (fullHistory) await io.replaceDailySummary(summaryRows)
      else await io.upsertDailySummary(summaryRows)
    })
    // Illness radar (Sub-plan E §5.5): persist the completed-form flag/score/biomarkers per night
    // from the SAME baseline-z the readiness route computes live (illnessFromSummaries), so stored
    // and displayed illness can't diverge. Own step so a failure can't block the summary write;
    // writes only the illness_* columns (COALESCE upsert) so it never clobbers body_comp's
    // source/model_versions on the same row. Each night keys off the prior night's baseline.
    await step('illness_radar', async () => {
      for (let i = 1; i < summaryRows.length; i++) {
        const res = illnessFromSummaries(summaryRows[i - 1], summaryRows[i])
        await io.upsertDailyDerived(summaryRows[i].date, {
          illnessFlag: res.flag,
          illnessScore: res.score,
          illnessBiomarkers: res.biomarkers,
        })
      }
    })

    // BDI reclaim (Sub-plan E): persist the per-night breathing-disturbance index computed as a
    // free byproduct of the SleepNet staging pass (apnea head), keyed by wake date. Own step
    // (COALESCE upsert of only bdi_derived) so a failure can't block the summary/illness writes;
    // null-BDI (heuristic-fallback) nights simply aren't in the map, so nothing is clobbered.
    if (bdiByDate.size > 0) await step('bdi_derived', async () => {
      for (const [day, perHour] of bdiByDate) {
        await io.upsertDailyDerived(day, { bdiDerived: perHour })
      }
    })

    // D5 — own daytime-HRV: throttled refit (own step, isolated the same way every other step
    // here is — a refit failure or slow pass must never block the summary/illness/resilience
    // writes below it, which is exactly why this runs BEFORE resilience reads the model).
    await step('daytime_hrv_model_refit', () => io.refitDaytimeHrvModel(timezone))

    // Stress-resilience (stress_resilience_2_2_1, Sub-plan E P3): per night, assemble the daytime
    // stress series + our own readiness contributors, compute the three daily indices, and fit the
    // resilience level over the trailing 14-day window of persisted indices. Own step so a failure
    // can't block the summary/illness writes; writes only the resilience_* columns (COALESCE upsert).
    // The daytime series runs one dHRV-model pass per 30-min bucket (D5's own regression, not
    // Oura's ONNX anymore), so cap the backfill at the recent window that actually feeds a level
    // (14) plus margin — older days stay whatever they were.
    await step('resilience', async () => {
      const dhrvModel = await io.readDaytimeHrvModel()
      const toMs = (ds: number) => toDate(ds).getTime()
      const collect = <T>(rows: { ds: unknown; decoded: unknown }[], key: string, map: (v: number, tsMs: number) => T): T[] => {
        const out: T[] = []
        for (const r of rows) { const t = toMs(Number(r.ds)); for (const v of numArr(r.decoded, key)) out.push(map(v, t)) }
        return out
      }
      const allTemp = [
        ...collect(tempRows, 'temps_c', (valueC, tsMs) => ({ tsMs, valueC })),
        ...collect(sleepSignal.filter(r => Number(r.tag) === 0x75), 'temps_c', (valueC, tsMs) => ({ tsMs, valueC })),
      ].sort((a, b) => a.tsMs - b.tsMs)
      const allMet = collect(metRows, 'met', (value, tsMs) => ({ tsMs, value })).sort((a, b) => a.tsMs - b.tsMs)
      const allHr = [
        ...collect(ibiRows, 'hr_bpm', (bpm, tsMs) => ({ tsMs, bpm })),
        ...collect(aohrRows, 'bpm', (bpm, tsMs) => ({ tsMs, bpm })),
      ].filter(h => h.bpm >= 35 && h.bpm <= 200).sort((a, b) => a.tsMs - b.tsMs)

      const sleepByDate = new Map(sleepRows.map(sr => [sr.date, sr]))
      const dayMinus = (dayStr: string, n: number): string => {
        const [y, m, d] = dayStr.split('-').map(Number)
        return toAestDay(new Date(aestMidnight(y, m, d, timezone).getTime() - n * 86_400_000), timezone)
      }

      // Needs a prior night for the baseline-z contributors (loop starts at i=1), so <2 rows = nothing to do.
      if (summaryRows.length < 2) return
      const RESILIENCE_MAX_DAYS = 21
      const startI = Math.max(1, summaryRows.length - RESILIENCE_MAX_DAYS)
      // Seed the rolling window from already-persisted indices (older than the recompute span),
      // then overlay each freshly computed day so later days in the loop see earlier ones.
      const indexByDay = new Map<string, DailyIndices>()
      const persisted = await io.readDailyDerived(dayMinus(summaryRows[startI].date, 13), summaryRows[summaryRows.length - 1].date)
      for (const r of persisted) {
        if (r.resilienceDailyStress != null && r.resilienceDailyRestorativeTime != null && r.resilienceDailySleepRecovery != null) {
          indexByDay.set(r.day, {
            dailyStress: r.resilienceDailyStress,
            dailyRestorativeTime: r.resilienceDailyRestorativeTime,
            dailySleepRecovery: r.resilienceDailySleepRecovery,
          })
        }
      }

      for (let i = startI; i < summaryRows.length; i++) {
        const latest = summaryRows[i], prior = summaryRows[i - 1]
        const day = latest.date
        const [y, m, d] = day.split('-').map(Number)
        const dayStartMs = aestMidnight(y, m, d, timezone).getTime()
        const dayEndMs = aestMidnight(y, m, d + 1, timezone).getTime()

        // Night HRV baseline (ms): the smoothed personal baseline (×8 fixed-point), else the
        // night's own average as a cold-start proxy. Doubles as the daytime-stress scaling anchor.
        const nightHrvMs = latest.hrvBaseline != null ? latest.hrvBaseline.meanX8 / 8 : latest.hrvAvgMs
        const dayTemp = allTemp.filter(s => s.tsMs >= dayStartMs && s.tsMs < dayEndMs)
        const tempBaseline = dayTemp.length ? dayTemp.reduce((s, t) => s + t.valueC, 0) / dayTemp.length : null

        // D5: own-model daytime-HRV (dhrvModel) replaces the ONNX imputation in production. No
        // ONNX fallback when dhrvModel is null (cold start / not enough training data yet) —
        // same infallible-null contract as before (no stress contribution shown), never a
        // silent re-anchor to Oura's opinion. `buildDaytimeStressSeries` (ONNX) stays golden-
        // tested and importable, just unreachable from this production path until D7.
        let series: { tMs: number; level: number }[] = []
        if (dhrvModel && nightHrvMs != null && nightHrvMs > 0 && latest.rhrLowBpm != null && latest.rhrLowBpm > 0 && tempBaseline != null && tempBaseline > 0) {
          const baselines: DhrvBaselines = { dhrvBaseline: nightHrvMs, hrBaseline: latest.rhrLowBpm, tempBaseline }
          const pts = buildDaytimeStressSeriesFromModel(
            dayTemp,
            allMet.filter(s => s.tsMs >= dayStartMs && s.tsMs < dayEndMs),
            allHr.filter(s => s.tsMs >= dayStartMs && s.tsMs < dayEndMs),
            dhrvModel, baselines, dayStartMs, dayEndMs,
          )
          series = pts.map(p => ({ tMs: p.t, level: p.stressLevel }))
        }

        // TN-3a — persist the buckets. `summarizeStressDay` reduces this series to three daily
        // scalars, and those are too compressed to answer "which hours run hottest" (the daily
        // aggregate spans only −0.14 … +0.23 on a [−1,+1] scale across 31 measured days). The
        // series is written here rather than at `/api/body-battery` because THIS is the path that
        // can back-fill: it re-derives each day from the packed raw tier, so a wide pass fills
        // history instead of starting from today.
        //
        // Writing from one place also settles the two-baselines hazard the entry flags: the live
        // route builds the same series from `restingHr` + a 28-day HRV mean, this one from
        // `latest.rhrLowBpm` + `nightHrvMs`. Persisting both would put two numbers behind one
        // metric. The rollup wins because it is the only one that can reach history.
        //
        // Failure is contained: a bucket write must never abort the readiness/resilience writes
        // below it, which are what the user actually sees.
        try {
          await io.replaceStressBuckets(day, series.map(p => ({ bucketStart: new Date(p.tMs), level: p.level })))
        } catch (err) {
          console.error(`[rollup] stress bucket write failed for ${day}, continuing:`, err)
        }

        const { rhrZ, hrvZ } = illnessZScores(prior, latest)
        const comp = computeReadinessComposite({
          rhrZ, hrvZ, tempZ: null, sleepBalanceZ: null, previousNightScore: null,
          prevDayActivityScore: null, activityBalanceScore: null,
          nHistory: latest.nHistory, recoveryIndexHours: latest.recoveryIndexHours,
        })
        const sr = sleepByDate.get(day)
        // Baselines from the nights strictly before this one — same shared derivation every other
        // caller uses, so the resilience model sees the same Sleep Score the user does.
        const sleepScore = sr
          ? computeSleepScore(sr as unknown as SleepSession, timezone, sleepScoreBaselines(
              sleepRows.filter(r => r.date < sr.date) as unknown as Parameters<typeof sleepScoreBaselines>[0],
              timezone,
            ))?.score ?? null
          : null

        const cutoff = dayMinus(day, 13)
        const priorIndices = [...indexByDay.entries()]
          .filter(([dd]) => dd >= cutoff && dd < day)
          .sort((a, b) => a[0].localeCompare(b[0]))
          .map(([, v]) => v)

        const res = computeResilienceForDay({
          sleepStartMs: sr ? [sr.sleepStart.getTime()] : [],
          sleepEndMs: sr ? [sr.sleepEnd.getTime()] : [],
          sleepScore,
          // A provisional (learning-period) baseline contributor falls back to a fabricated 50 —
          // pass null so it doesn't invent a daily index. hrvBalance null → the model's hrv-free
          // path; recovery-index is a real derived value whenever its hours are present.
          hrvBalance: comp.contributors.hrvBalance.provisional ? null : comp.contributors.hrvBalance.score,
          recoveryIndex: latest.recoveryIndexHours != null ? comp.contributors.recoveryIndex.score : null,
          restingHeartRate: comp.contributors.restingHeartRate.provisional ? null : comp.contributors.restingHeartRate.score,
          stressSeries: series,
          nightHrvBaselineMs: nightHrvMs,
        }, priorIndices)

        if (res.dailyIndices) indexByDay.set(day, res.dailyIndices)
        if (res.dailyIndices || res.level != null) {
          await io.upsertDailyDerived(day, {
            resilienceLevel: res.level,
            resilienceGranular: res.granular,
            resilienceConfidence: res.confidence,
            resilienceDailyStress: res.dailyIndices?.dailyStress ?? null,
            resilienceDailyRestorativeTime: res.dailyIndices?.dailyRestorativeTime ?? null,
            resilienceDailySleepRecovery: res.dailyIndices?.dailySleepRecovery ?? null,
          })
        }
      }
    })

    // Chronic stress (cumulative_stress_1_2_2): assemble the trailing 31-night input for the most
    // recent night and run the golden-verified model. Own step (COALESCE upsert of only the
    // chronic_stress_* columns) so a failure can't block the writes above. The score is null until
    // 21 complete nights of granular BLE signals exist in the window (the model's own gate) — skip
    // the write entirely on null so a sparse/incremental pass never clobbers a prior good score.
    // NOTE: the intermediate history is built from THIS pass's stashed signals, so the first score
    // requires a wide/full rollup pass covering ≥21 nights of real ring data (owner/device-gated).
    await step('chronic_stress', async () => {
      if (summaryRows.length < CHRONIC_STRESS_MIN_DAYS) return
      const res = computeChronicStress(summaryRows, chronicStressSignalsByDate)
      if (!res) return
      const score = chronicStressScoreToInt(res.chronicStressScore)
      if (score == null) return
      await io.upsertDailyDerived(summaryRows[summaryRows.length - 1].date, {
        chronicStressScore: score,
        chronicStressContributors: {
          fragmentation: res.uiFragmentation,
          heart: res.uiHeart,
          sleepMotions: res.uiSleepMotions,
          activity: res.uiActivity,
          temperature: res.uiTemperature,
        },
      })
    })
  }
  }

  // Body composition (Sub-plan F §7.1): persist the completed-form fat/lean/BMR snapshot from
  // the user's logged weight+body-fat. Not BLE-derived — its own step so a failure here can't
  // block the BLE writes above (and vice-versa).
  await step('body_comp', async () => { await io.persistBodyComp() })

  // Record how far this run reached, so a fresh process can narrow from here instead of
  // re-deriving the whole 35-day window on its first ingest. That cold-start pass was measured in
  // production at six minutes of a pegged main thread, paid on every deploy (Q-213 follow-up).
  // Only a windowed run may advance it: a `dumpOnly` debug pass writes nothing, and a
  // `fullHistory` redecode legitimately covers everything but is triggered by hand, so neither
  // should move a watermark that governs routine ingest.
  if (!opts?.dumpOnly) {
    await step('rollup_watermark', async () => {
      await io.writeRollupWatermark(anchor.anchorDs, currentEpoch(anchors) ?? 0)
    })
  }

  return {
    sleepSessions: sleepRows.length,
    bodyMetricDays: byDay.size,
    daysWritten: Array.from(new Set([...sleepRows.map(r => r.date), ...byDay.keys()])).sort(),
    hrSeriesPoints: hrSeriesRows.length,
    wearDays: wearRows.length,
    stepErrors,
    debugNight,
  }
}
