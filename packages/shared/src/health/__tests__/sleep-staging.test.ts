import { describe, it, expect } from 'vitest'
import { stageSleep, stageSleepDetailed, summarizeSleepStages, refineOnsetLatencySec, ultradianRemBias, type SleepEpoch, type OnsetSample } from '@trainingai/shared/health/sleep-staging'
import type { SleepStage } from '@trainingai/shared/health/hypnogram'

const ep = (hr: number | null, hrv: number | null, movement: number | null, temp: number | null = 35): SleepEpoch =>
  ({ hr, hrv, movement, temp })

describe('stageSleep', () => {
  it('assigns contiguous physiological-signature blocks to deep / rem / light and detects wake', () => {
    // Deep early = low + STABLE HR, high HRV, warm skin. REM later = elevated + VARIABLE HR, low HRV,
    // still. Light = middling. Wake = sustained movement. (Signatures match the documented per-stage
    // correlations the stager scores on.)
    // Graded HR variability (what the stability term reads): deep ≈ flat, light ≈ mild, rem ≈ high.
    const deepHr = (i: number) => 48 + (i % 2) * 0.5      // ~flat
    const lightHr = (i: number) => 53 + ((i % 3) - 1)       // 52/53/54 — mild, clearly below REM
    const remHr = (i: number) => (i % 2 === 0 ? 60 : 70)    // 60/70 — elevated + high variability
    const night: SleepEpoch[] = [
      ...Array(12).fill(0).map((_, i) => ep(deepHr(i), 66, 0.1, 36)),  // deep: low + stable HR, high HRV, warm, early
      ...Array(24).fill(0).map((_, i) => ep(remHr(i), 30, 0.1, 35)),   // rem: elevated + variable HR, low HRV
      ...Array(60).fill(0).map((_, i) => ep(lightHr(i), 46, 0.1, 35)), // light: middling
      ...Array(4).fill(ep(85, 40, 50, 35)),                            // wake: movement
    ]
    const s = stageSleep(night)
    expect(s.slice(0, 12).every(x => x === 'deep')).toBe(true)
    expect(s.slice(12, 36).every(x => x === 'rem')).toBe(true)
    expect(s.slice(36, 96).every(x => x === 'light')).toBe(true)
    expect(s.slice(96)).toEqual<SleepStage[]>(['awake', 'awake', 'awake', 'awake'])
  })

  it('lets proportions float with the data — more deep-signature ⇒ more deep (not a forced quota)', () => {
    const mk = (nDeep: number) => stageSleep([
      ...Array(nDeep).fill(ep(48, 66, 0.1)),        // clear deep signature
      ...Array(96 - nDeep).fill(ep(56, 42, 0.1)),    // light-ish
    ])
    const deepFrac = (s: SleepStage[]) => s.filter(x => x === 'deep').length / s.length
    expect(deepFrac(mk(30))).toBeGreaterThan(deepFrac(mk(6)))
  })

  it('does not fabricate deep/REM on a flat night with no clear signatures', () => {
    // Uniform signals ⇒ nothing crosses the cutoffs ⇒ honestly all light (no padding to an average).
    const flat = Array.from({ length: 40 }, () => ep(54, 45, 0.1))
    const s = stageSleep(flat)
    expect(s.every(x => x === 'light')).toBe(true)
  })

  it('lets within-epoch HR spread grow REM proportionally (a real signal, not a quota)', () => {
    // REM signature (elevated + variable HR, low HRV, high within-epoch spread), placed late in the
    // night — the same "floats with the data" property already proven for deep (line 30 above),
    // applied to the within-epoch-spread signal. A bigger REM-signature block ⇒ strictly more REM.
    const remBlock = (i: number) => ({ hr: 65 + (i % 2) * 4, hrv: 28, movement: 0.1, temp: 35, hrVar: 14 })
    const baseline = { hr: 55, hrv: 45, movement: 0.1, temp: 35, hrVar: 4 }
    const mk = (nRem: number): SleepEpoch[] => [
      ...Array(96 - nRem).fill(baseline),
      ...Array(nRem).fill(0).map((_, i) => remBlock(i)), // late in the night
    ]
    const remCount = (s: SleepStage[]) => s.filter(x => x === 'rem').length
    expect(remCount(stageSleep(mk(30)))).toBeGreaterThan(remCount(stageSleep(mk(6))))
  })

  it('within-epoch spread is neutral when uniform or absent (no per-beat data cannot skew a night)', () => {
    // A uniform hrVar has no spread for the per-night z-score to read, so it must produce exactly
    // the same stages as omitting hrVar entirely — the signal only acts on genuine variation.
    const mk = (hrVar?: number): SleepEpoch[] =>
      Array.from({ length: 30 }, (_, i) => ({ hr: 52 + (i % 5), hrv: 45, movement: 0.1, temp: 35, ...(hrVar != null ? { hrVar } : {}) }))
    expect(stageSleep(mk(5))).toEqual(stageSleep(mk()))
  })

  it('LF/HF is neutral when uniform or absent (a night without dense beats is unaffected)', () => {
    // A uniform lfhf has no spread for the per-night z-score to read, so it must produce exactly the
    // same stages as omitting lfhf entirely — self-neutralising, exactly like the breathVar term.
    const mk = (lfhf?: number): SleepEpoch[] =>
      Array.from({ length: 30 }, (_, i) => ({ hr: 52 + (i % 5), hrv: 45, movement: 0.1, temp: 35, hrVar: 5, breathVar: 0.5, ...(lfhf != null ? { lfhf } : {}) }))
    expect(stageSleep(mk(1.5))).toEqual(stageSleep(mk()))
  })

  it('a high-LF/HF block grows REM vs the same block with neutral LF/HF', () => {
    // Two identical nights except the candidate REM block carries elevated LF/HF in one. The extra
    // sympathetic-leaning signal must push at least as much of that block into REM, never less.
    const light: SleepEpoch = { hr: 55, hrv: 45, movement: 0.1, temp: 35, hrVar: 4, breathVar: 0.4, lfhf: 1.0 }
    const remBase = (i: number): SleepEpoch => ({ hr: 60 + (i % 2) * 4, hrv: 34, movement: 0.1, temp: 35, hrVar: 9, breathVar: 0.7, lfhf: 1.0 })
    const mkNight = (remLfhf: number): SleepEpoch[] => [
      ...Array(40).fill(light),
      ...Array(10).fill(0).map((_, i) => ({ ...remBase(i), lfhf: remLfhf })),
      ...Array(20).fill(light),
    ]
    const remCount = (s: SleepStage[]) => s.slice(40, 50).filter(x => x === 'rem').length
    const withHigh = remCount(stageSleep(mkNight(4.0)) as SleepStage[])
    const withNeutral = remCount(stageSleep(mkNight(1.0)) as SleepStage[])
    expect(withHigh).toBeGreaterThanOrEqual(withNeutral)
  })

  it('SpO2 variability is neutral when uniform or absent (a night with a quiet oximeter is unaffected)', () => {
    // A uniform spo2Var has no spread for the per-night z-score to read, so it must produce exactly
    // the same stages as omitting it entirely — self-neutralising, like breathVar and lfhf.
    const mk = (spo2Var?: number): SleepEpoch[] =>
      Array.from({ length: 30 }, (_, i) => ({ hr: 52 + (i % 5), hrv: 45, movement: 0.1, temp: 35, hrVar: 5, breathVar: 0.5, ...(spo2Var != null ? { spo2Var } : {}) }))
    expect(stageSleep(mk(0.6))).toEqual(stageSleep(mk()))
  })

  it('the SpO2 term is actually read — a night differing only in its spo2Var column stages differently', () => {
    // Proves the wiring, which the neutrality test above cannot: two nights identical in every
    // signal except spo2Var, on a deliberately low-contrast night where many epochs sit near the
    // cutoffs. If W_SPO2 were 0 (or the term were never plumbed through the rollup) these would be
    // identical. Deliberately asserts only that the column MOVES stages, not which way: the
    // per-night z-score is relative, so raising one block's variability also pushes every other
    // epoch's z down, and on a synthetic night the time-of-night prior can dominate either effect.
    // Whether the term helps is a question only a real redecoded night can answer — see
    // docs/oura-ble-sleep-staging-findings.md, which is where its verdict belongs.
    const mk = (spo2Var: (i: number) => number): SleepEpoch[] =>
      Array.from({ length: 60 }, (_, i) => ({
        hr: 54 + Math.sin(i / 4) * 3, hrv: 42 - Math.sin(i / 4) * 5, movement: 0.1, temp: 35,
        hrVar: 5 + Math.sin(i / 5) * 1.5, breathVar: 0.5 + Math.sin(i / 6) * 0.1, spo2Var: spo2Var(i),
      }))
    const flat = stageSleep(mk(() => 0.5))
    const varied = stageSleep(mk(i => (i >= 25 && i < 40 ? 2.5 : 0.4)))
    expect(varied).not.toEqual(flat)
  })

  it('counts restless (moving) pre-sleep as onset latency, then settles', () => {
    // Tossing/settling in bed (clear movement) before falling still + settled = onset latency.
    const night: SleepEpoch[] = [
      ...Array(4).fill(ep(64, 40, 30)),    // in bed, restless: movement ⇒ awake
      ...Array(40).fill(ep(48, 60, 0.1)),  // asleep: still + HR settled
    ]
    const s = stageSleep(night)
    expect(s.slice(0, 4).every(x => x === 'awake')).toBe(true) // onset latency (movement-driven)
    expect(s.slice(4).some(x => x !== 'awake')).toBe(true)     // then asleep
    expect(summarizeSleepStages(s).onsetLatencyMin).toBe(20)   // 4 epochs × 5 min
  })

  it('counts a still but elevated-HR early stretch as sleep, not onset latency (the 07-08 case)', () => {
    // Real case: ~100 min of measurably-still epochs (movement recorded ≈ 0) at an elevated HR,
    // then HR drops. That still, elevated-HR stretch is early sleep — NOT time lying awake — so it
    // must not be trimmed to awake the way a pure HR-settle rule did (it reported a 105-min onset).
    const night: SleepEpoch[] = [
      ...Array(20).fill(ep(74, 34, 0)),    // still (movement 0) but elevated HR
      ...Array(40).fill(ep(62, 50, 0)),    // still, HR settled lower
    ]
    const s = stageSleep(night)
    expect(s[0]).not.toBe('awake')                                  // asleep from the start (still)
    expect(summarizeSleepStages(s).onsetLatencyMin).toBeLessThanOrEqual(5)
  })

  it('still does trim leading epochs that have NO movement data and unsettled HR (07-09 stays correct)', () => {
    // A sparse leading epoch (no movement recorded) at an unsettled HR must NOT count as asleep —
    // otherwise it would prematurely end the trim and zero out a real latency. Here the first epoch
    // has null movement + elevated HR, the second has real movement, then sleep settles.
    const night: SleepEpoch[] = [
      ep(70, null, null),                  // sparse, unsettled ⇒ not "still", not settled ⇒ awake
      ep(70, null, 30),                    // real movement ⇒ awake
      ...Array(40).fill(ep(60, 55, 0.1)),  // asleep
    ]
    const s = stageSleep(night)
    expect(s.slice(0, 2).every(x => x === 'awake')).toBe(true)
    // The key invariant: a real latency is preserved (not collapsed to 0 by the sparse leading
    // epoch prematurely counting as "still").
    expect(summarizeSleepStages(s).onsetLatencyMin).toBeGreaterThanOrEqual(10)
  })

  it('folds an isolated single-epoch mid-sleep movement blip back into sleep (a stir, not a wake)', () => {
    // A lone 5-min epoch of elevated movement surrounded by sleep on both sides is a micro-arousal,
    // not a true awakening — commercial trackers count these as restless periods WITHIN sleep,
    // not as subtracted Awake time.
    const night: SleepEpoch[] = Array.from({ length: 21 }, (_, i) => (i === 10 ? ep(72, 40, 60) : ep(52, 48, 0.1)))
    const s = stageSleep(night)
    expect(s[10]).not.toBe('awake')
    expect(s[10]).toBe(s[9]) // folded into the stage it interrupted
  })

  it('keeps a SUSTAINED mid-sleep awakening (2+ epochs of movement) as real wake', () => {
    const night: SleepEpoch[] = Array.from({ length: 21 }, (_, i) => (i === 10 || i === 11 ? ep(72, 40, 60) : ep(52, 48, 0.1)))
    const s = stageSleep(night)
    expect(s[10]).toBe('awake')
    expect(s[11]).toBe('awake')
  })

  it('does not fold an isolated mid-sleep wake epoch when movement was never measured', () => {
    // Movement null (unmeasured) is a different situation from measured-and-low — we can't attest
    // it was just a stir, so it's left as awake (mirrors the onset trim's null-movement guard).
    const night: SleepEpoch[] = Array.from({ length: 21 }, (_, i) => (i === 10 ? ep(72, 40, null) : ep(52, 48, 0.1)))
    const s = stageSleep(night)
    expect(s[10]).toBe('awake')
  })

  it('does not fold a leading/trailing (onset/offset) awake run — only interior bouts qualify', () => {
    // A short awake run touching either edge of the night is the onset/offset trim's territory,
    // not a mid-sleep stir — must not be folded away by the new interior-only rule.
    const night: SleepEpoch[] = [ep(72, 40, 60), ep(72, 40, 60), ...Array(20).fill(ep(52, 48, 0.1))]
    const s = stageSleep(night)
    expect(s[0]).toBe('awake')
  })

  it('bridges a brief mid-bout REM dip into the surrounding REM (transition prior, not per-epoch)', () => {
    // A late REM bout whose signal briefly wavers for one epoch. REM is continuous, so a single
    // weak epoch flanked by strong REM on both sides must stay REM — the exact case the old
    // per-epoch cutoff + MIN_BOUT smoothing would have carved into a light hole.
    const remEp = (i: number): SleepEpoch => ({ hr: 66 + (i % 2) * 6, hrv: 28, movement: 0.1, temp: 35, hrVar: 15, breathVar: 1.0 })
    const dip: SleepEpoch = { hr: 58, hrv: 40, movement: 0.1, temp: 35, hrVar: 5, breathVar: 0.45 } // wavering REM signal
    const light: SleepEpoch = { hr: 55, hrv: 45, movement: 0.1, temp: 35, hrVar: 4, breathVar: 0.4 }
    const night: SleepEpoch[] = [
      ...Array(60).fill(light),
      ...Array(6).fill(0).map((_, i) => remEp(i)), // 60–65 strong REM
      dip,                                          // 66 brief waver
      ...Array(6).fill(0).map((_, i) => remEp(i)), // 67–72 strong REM
    ]
    const s = stageSleep(night)
    expect(s[66]).toBe('rem')                       // dip bridged, no light hole mid-bout
    expect(s.slice(60, 73).every(x => x === 'rem')).toBe(true)
  })

  it('does not bridge a sustained light region between REM bouts (proportional, not unconditional)', () => {
    // Two REM bouts separated by a long, clearly-light stretch. The switch cost is finite, so a
    // sustained light region is never absorbed into REM — only brief flanked dips are.
    const remEp = (i: number): SleepEpoch => ({ hr: 66 + (i % 2) * 6, hrv: 28, movement: 0.1, temp: 35, hrVar: 15, breathVar: 1.0 })
    const light: SleepEpoch = { hr: 55, hrv: 45, movement: 0.1, temp: 35, hrVar: 4, breathVar: 0.4 }
    const night: SleepEpoch[] = [
      ...Array(40).fill(light),
      ...Array(6).fill(0).map((_, i) => remEp(i)),  // REM bout A
      ...Array(20).fill(light),                      // sustained light
      ...Array(6).fill(0).map((_, i) => remEp(i)),  // REM bout B
    ]
    const s = stageSleep(night)
    expect(s.slice(46, 66).some(x => x === 'light')).toBe(true) // the long light stretch is not eaten
  })

  it('leaves DEEP untouched even when a REM bout sits right beside it (priority stage preserved)', () => {
    // Deep is assigned by its own unchanged z-cutoff BEFORE the REM/light Viterbi runs and is never
    // revisited, so an adjacent REM bout can never erode the deep block.
    const deepEp: SleepEpoch = { hr: 46, hrv: 68, movement: 0.1, temp: 36, hrVar: 3, breathVar: 0.3 }
    const remEp = (i: number): SleepEpoch => ({ hr: 66 + (i % 2) * 6, hrv: 28, movement: 0.1, temp: 35, hrVar: 15, breathVar: 1.0 })
    const light: SleepEpoch = { hr: 55, hrv: 45, movement: 0.1, temp: 35, hrVar: 4, breathVar: 0.4 }
    const night: SleepEpoch[] = [
      ...Array(12).fill(deepEp),                     // 0–11 deep, early
      ...Array(12).fill(0).map((_, i) => remEp(i)), // 12–23 REM
      ...Array(60).fill(light),
    ]
    const s = stageSleep(night)
    expect(s.slice(0, 12).every(x => x === 'deep')).toBe(true)
  })

  it('treats an all-null epoch (not measuring) as awake', () => {
    expect(stageSleep([ep(null, null, null)])).toEqual<SleepStage[]>(['awake'])
  })

  it('returns empty for no epochs', () => {
    expect(stageSleep([])).toEqual([])
  })
})

describe('refineOnsetLatencySec', () => {
  it('pinpoints onset to the HR-sample time within the onset epoch (finer than the 5-min grid)', () => {
    // Onset epoch is index 2 (grid onset = 600s). HR settles to threshold 132s into that epoch,
    // i.e. 600 + 132 = 732s — a value the 5-min grid could never express.
    const result = { stages: ['awake', 'awake', 'light', 'deep', 'deep'] as const, onsetEpoch: 2, settleHr: 50 }
    const samples: OnsetSample[] = [
      { tSec: 610, hr: 58 }, // still elevated
      { tSec: 700, hr: 55 },
      { tSec: 732, hr: 49 }, // first at/below threshold
      { tSec: 760, hr: 47 },
    ]
    expect(refineOnsetLatencySec({ ...result, stages: [...result.stages] }, samples)).toBe(732)
  })

  it('stays within the onset epoch — a stray low sample in an earlier epoch is ignored', () => {
    const result = { stages: ['awake', 'awake', 'light'] as const, onsetEpoch: 2, settleHr: 50 }
    const samples: OnsetSample[] = [
      { tSec: 30, hr: 40 },  // transient dip while still awake — must NOT count as onset
      { tSec: 650, hr: 45 }, // real settle, inside the onset epoch
    ]
    expect(refineOnsetLatencySec({ ...result, stages: [...result.stages] }, samples)).toBe(650)
  })

  it('falls back to the epoch-start grid value when no sample settles in the onset epoch', () => {
    const result = { stages: ['awake', 'light'] as const, onsetEpoch: 1, settleHr: 50 }
    expect(refineOnsetLatencySec({ ...result, stages: [...result.stages] }, [])).toBe(300)
  })

  it('reports the whole window as latency when the night never settles', () => {
    const result = { stages: ['awake', 'awake', 'awake'] as const, onsetEpoch: 3, settleHr: null }
    expect(refineOnsetLatencySec({ ...result, stages: [...result.stages] }, [])).toBe(900)
  })

  it('stageSleepDetailed exposes an onset epoch consistent with the stages', () => {
    const night: SleepEpoch[] = [
      ...Array(4).fill(ep(64, 40, 30)),    // in bed, restless (movement) ⇒ awake onset
      ...Array(40).fill(ep(48, 60, 0.1)),  // asleep
    ]
    const d = stageSleepDetailed(night)
    expect(d.stages.findIndex(s => s !== 'awake')).toBe(d.onsetEpoch)
    expect(d.onsetEpoch).toBe(4)
    expect(d.settleHr).not.toBeNull()
  })
})

describe('summarizeSleepStages', () => {
  it('computes stage minutes, efficiency, onset latency and awakenings', () => {
    const stages: SleepStage[] = ['awake', 'awake', 'light', 'deep', 'deep', 'rem', 'light', 'awake']
    const m = summarizeSleepStages(stages)
    expect(m.deepMin).toBe(10)
    expect(m.remMin).toBe(5)
    expect(m.lightMin).toBe(10)
    expect(m.awakeMin).toBe(15)
    expect(m.timeAsleepMin).toBe(25)
    expect(m.timeInBedMin).toBe(40)
    expect(m.efficiencyPct).toBe(63) // 25/40
    expect(m.onsetLatencyMin).toBe(10) // first non-awake at index 2
    expect(m.awakenings).toBe(1) // one wake run after onset (the trailing awake)
  })
})

describe('ultradianRemBias (the ~90-min cycle prior)', () => {
  const CYCLE = 95 // must track ULTRADIAN_MIN

  it('is periodic, not a monotonic ramp — peaks at cycle boundaries, troughs mid-cycle', () => {
    // The whole point of this term: a linear "REM skews late" prior cannot express that REM RECURS.
    // Sample a 7-hour night and confirm the extrema land on the cycle grid rather than climbing.
    const peak = (k: number) => ultradianRemBias(k * CYCLE)
    const trough = (k: number) => ultradianRemBias((k + 0.5) * CYCLE)
    for (const k of [1, 2, 3, 4]) {
      expect(peak(k)).toBeGreaterThan(0)
      expect(trough(k)).toBeLessThan(0)
      // Each cycle boundary must beat the mid-cycle dips on either side of it — the defining
      // periodic shape. A monotonic ramp would fail the second half of this.
      expect(peak(k)).toBeGreaterThan(trough(k))
      expect(peak(k)).toBeGreaterThan(trough(k - 1))
    }
  })

  it('starts at zero and grows across the night, so cycle 1 is not treated like cycle 4', () => {
    // REM is short or absent in the first cycle and dominant by the fourth. The amplitude ramp is
    // what encodes that, and it is also what stops the cos peak at minute 0 favouring REM at onset.
    expect(ultradianRemBias(0)).toBe(0)
    expect(Math.abs(ultradianRemBias(CYCLE))).toBeLessThan(Math.abs(ultradianRemBias(4 * CYCLE)))
    expect(ultradianRemBias(CYCLE)).toBeLessThan(ultradianRemBias(2 * CYCLE))
    expect(ultradianRemBias(2 * CYCLE)).toBeLessThan(ultradianRemBias(3 * CYCLE))
  })

  it('saturates rather than growing without bound on a long night', () => {
    expect(ultradianRemBias(4 * CYCLE)).toBeCloseTo(1, 6)
    expect(ultradianRemBias(8 * CYCLE)).toBeCloseTo(1, 6)
    expect(Math.abs(ultradianRemBias(12.5 * CYCLE))).toBeLessThanOrEqual(1)
  })

  it('is neutral for degenerate input rather than throwing or returning NaN', () => {
    expect(ultradianRemBias(-30)).toBe(0)
    expect(ultradianRemBias(NaN)).toBe(0)
    expect(ultradianRemBias(Infinity)).toBe(0)
  })
})
