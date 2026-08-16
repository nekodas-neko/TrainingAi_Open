import { describe, it, expect } from 'vitest'
import { hexToBytes } from '../oura-ble/decode'
import { pairStepFeatures, type StepFeatureFrame } from '../oura-ble/step-features'
import { estimateSteps, isWalkingWindow, mergeStepSources, mergeStepCounterWithLive, isPlausibleStepWindow, dedupeOverlappingWindows, MAX_PLAUSIBLE_STEPS_PER_SEC, GATE_WINDOW_SPAN_DS, STEPS_PER_WINDOW, WALK_CADENCE_COLUMN, type StepCountWindow } from '@trainingai/shared/health/step-estimate'

// Real captured ring frames (owner's counted-walk calibration, 2026-07-10). Each entry is
// [feature_1 ds, f1 hex, f2 hex]; feature_2 sits at ds+1. These pin the walk-gate against
// the exact data the threshold was calibrated on — a formula/threshold change that alters
// these outcomes is a recalibration, not a refactor.
type Cap = [number, string, string]

const WALK_100: Cap[] = [
  [4210916, '67b84f1e595e5a889e2b7601575f', '344aaa1a87a52254123bc9625fd2'],
  [4211215, '97956002455c1f5ec261e00a284a', '000dc461b78648600116cc8b4d8f'],
  [4211514, 'b9599e8b307c010cc05fd6812966', '0011c34eeb00005f0007c189573b'],
]
const WALK_200: Cap[] = [
  [4316504, 'ca61b3816965000baa5058893850', '764794519381194a0339ca993bd3'],
  [4316809, 'ab646b136d510b578f83608d665f', '133472f73c17412b705f9e5b7207'],
  [4317109, '90be4e1e3d006368c762da813a54', '010bbf6381854a762b2ccc8e49b8'],
  [4317409, 'bd53c011294d0014bf55ad05484e', '010aad52ae895f2f031dbe7a5f9d'],
  [4317705, 'bf52d20119660008bc5ea8853e7a', '0210b555850156610118c07058cf'],
  [4318005, 'c263c7011c7a020abe537d855b71', '061bb25f96824733153dcb8c432f'],
  [4318306, 'ba64ab823b85020eba62ca8a2d6b', '0111ab2c5622277e378dc98f3cb1'],
]
const WALK_SLOW_50: Cap[] = [
  [4365413, 'ba1ebb01426a01146e3f767b296b', '5922963d732e19a72166c6902dd7'], // col14=123 — missed
  [4365712, 'b12b70dd195d1d14bf29c6815e49', '0113b72ccd811c68011dc384403f'],
]
const WALK_FAST_50: Cap[] = [
  [4366313, '5ba8808e5a35233363f068927332', '1e95754d608d4f451a4ead8053d5'],
  [4366613, '70e14b065c000627c474cd8718a3', '0118c6719481617a010ebf9142ab'],
]
const WALK_NORMAL_50: Cap[] = [
  [4367209, '5a9c5d8d6c67204d70f375094b00', '3662a717989f1f680a24ca8332ce'],
  [4367509, 'bc54b88d3a7d010eb850b309408f', '0117b850b6951b8e0113be7e5735'],
]
const DESK_NOWALK: Cap[] = [
  [4346510, 'bd765395374c786a908646ae344b', '4b9a8acd4b8a4d533d75af4285b9'],
  [4346808, 'abd12a944e5d766eac0000ac3a00', '9353b8a852e3314f8d44b54592cd'],
  [4347111, 'b0f0543641008a5dbee149393b00', 'a04fa4ce34944251736bb3468d31'],
  [4347410, '487838403830a737b1cf3cb93733', 'a545bf0f1f354b009b49b43e8963'],
  [4347713, '9a00002a4e00757f450736643f26', '9d43909a202045275e8ab548a529'],
]
const IDLE_STILL: Cap[] = [
  // Dead-still tail of the idle capture (col0 306–356 — genuinely motionless).
  [4338863, '496f37334a22b63c44f746c74351', '914d47513a114132895355448177'],
  [4339166, '6200004a3900dc20458739c63c28', '9643472f30444e25b336583f9300'],
  [4339464, '44dd3bc4374ca73a46af3bda3e48', 'a13c44f655c5372fa6364e547201'],
  [4344173, '43f822c94a23a23b44f649cf444f', '9c3f479d223f3e25ae364c546a3a'],
]

function toPairs(caps: Cap[]) {
  const frames: StepFeatureFrame[] = []
  for (const [ds, f1, f2] of caps) {
    frames.push({ ds, tag: 0x7e, body: hexToBytes(f1) })
    frames.push({ ds: ds + 1, tag: 0x7f, body: hexToBytes(f2) })
  }
  return pairStepFeatures(frames)
}

describe('step estimate — col14 walk gate on the calibration captures', () => {
  it('flags every steady-walk window as walking (100/200/normal)', () => {
    for (const caps of [WALK_100, WALK_200, WALK_NORMAL_50]) {
      const pairs = toPairs(caps)
      expect(pairs).toHaveLength(caps.length)
      expect(pairs.every((p) => isWalkingWindow(p.columns))).toBe(true)
    }
  })

  it('catches both fast windows and 1 of 2 slow windows (known slow-walk miss)', () => {
    expect(toPairs(WALK_FAST_50).filter((p) => isWalkingWindow(p.columns))).toHaveLength(2)
    expect(toPairs(WALK_SLOW_50).filter((p) => isWalkingWindow(p.columns))).toHaveLength(1)
  })

  it('never flags desk typing or stillness as walking (no phantom steps)', () => {
    expect(toPairs(DESK_NOWALK).some((p) => isWalkingWindow(p.columns))).toBe(false)
    expect(toPairs(IDLE_STILL).some((p) => isWalkingWindow(p.columns))).toBe(false)
  })

  it('estimates a plausible count for the counted walks', () => {
    // 100-step walk → 3 windows → 90 estimated (−10%); all counted walks combined:
    // 450 real steps → 15 detected windows → 450 estimated (calibration identity).
    expect(estimateSteps(toPairs(WALK_100))).toEqual({ windows: 3, walkingWindows: 3, estimatedSteps: 90 })
    const all = toPairs([...WALK_100, ...WALK_200, ...WALK_SLOW_50, ...WALK_FAST_50, ...WALK_NORMAL_50])
    expect(estimateSteps(all).estimatedSteps).toBe(450)
  })

  it('estimates zero for a desk/idle day', () => {
    const est = estimateSteps(toPairs([...DESK_NOWALK, ...IDLE_STILL]))
    expect(est.walkingWindows).toBe(0)
    expect(est.estimatedSteps).toBe(0)
  })

  it('col14 exists in every unpacked vector', () => {
    for (const p of toPairs([...WALK_100, ...DESK_NOWALK])) {
      expect(typeof p.columns[WALK_CADENCE_COLUMN]).toBe('number')
    }
  })

  it('STEPS_PER_WINDOW matches the calibration-derived constant', () => {
    expect(STEPS_PER_WINDOW).toBe(30)
  })
})

describe('mergeStepSources — Tier-2-wins merge', () => {
  it('falls back to the full gate estimate with no live windows', () => {
    const pairs = toPairs(WALK_100) // 3 walking windows
    expect(mergeStepSources(pairs, [])).toBe(90)
  })

  it('a live window fully covering the gate windows overrides the estimate entirely', () => {
    const pairs = toPairs(WALK_100)
    const firstDs = pairs[0].ds
    const lastDs = pairs[pairs.length - 1].ds
    const live = [{ startDs: firstDs, endDs: lastDs + GATE_WINDOW_SPAN_DS, steps: 103 }]
    expect(mergeStepSources(pairs, live)).toBe(103)
  })

  it('a live window covering only part of the walk lets the estimate fill the gap', () => {
    const pairs = toPairs(WALK_200) // 7 walking windows, 30 apart
    const firstDs = pairs[0].ds
    // Cover only the first 3 windows live; the remaining 4 fall back to the estimate.
    const live = [{ startDs: firstDs, endDs: pairs[2].ds + GATE_WINDOW_SPAN_DS, steps: 65 }]
    expect(mergeStepSources(pairs, live)).toBe(65 + 4 * STEPS_PER_WINDOW)
  })

  it('a live window spanning midnight credits its steps to the day of its start (day bucketing is the caller\'s job)', () => {
    // mergeStepSources operates on a single day's paired windows — a live window that
    // spans midnight is handled by the caller bucketing it under its startDs's day, not
    // by this function, so a live window with no matching gate windows on this "day"
    // still contributes its steps in full (nothing to merge against).
    const live = [{ startDs: 1_000_000, endDs: 1_000_900, steps: 40 }]
    expect(mergeStepSources([], live)).toBe(40)
  })

  it('desk/idle gate windows never contribute, live or not', () => {
    const pairs = toPairs(DESK_NOWALK)
    expect(mergeStepSources(pairs, [])).toBe(0)
    const live = [{ startDs: pairs[0].ds, endDs: pairs[0].ds + GATE_WINDOW_SPAN_DS, steps: 5 }]
    expect(mergeStepSources(pairs, live)).toBe(5) // live steps still count even over a non-walking window
  })

  it('a live window that does not overlap any gate window adds on top of the full estimate', () => {
    const pairs = toPairs(WALK_100)
    const live = [{ startDs: 9_000_000, endDs: 9_000_900, steps: 12 }] // far away in ds-space
    expect(mergeStepSources(pairs, live)).toBe(90 + 12)
  })
})

describe('mergeStepCounterWithLive — D0 daily merge (step_counter primary + live override)', () => {
  it('drops a physically impossible MODEL window, not just a live one (Q-139)', () => {
    // The 2026-08-07 shape: a compressed ring clock folded ~28 min of walking into one 60 s block,
    // so the model emitted 1,555 steps in 60 s — 26 per second. The gate applied to live windows
    // only, so it went into the daily total unchallenged.
    const model: StepCountWindow[] = [
      { startMs: 0, endMs: 60_000, steps: 1_555 },
      { startMs: 60_000, endMs: 120_000, steps: 40 },
    ]
    expect(mergeStepCounterWithLive(model, [])).toBe(40)
  })

  const model: StepCountWindow[] = [
    { startMs: 0, endMs: 60_000, steps: 40.4 },
    { startMs: 60_000, endMs: 120_000, steps: 55.6 },
    { startMs: 120_000, endMs: 180_000, steps: 10 },
  ]

  it('with no live windows, returns the rounded model total', () => {
    expect(mergeStepCounterWithLive(model, [])).toBe(106) // round(40.4 + 55.6 + 10)
  })

  it('a live window overrides every model window it overlaps', () => {
    // Covers the first two model windows (0–120s); the third (10) survives.
    const live: StepCountWindow[] = [{ startMs: 0, endMs: 120_000, steps: 88 }]
    expect(mergeStepCounterWithLive(model, live)).toBe(88 + 10)
  })

  it('a live window covering the whole day overrides the model entirely', () => {
    const live: StepCountWindow[] = [{ startMs: 0, endMs: 180_000, steps: 120 }]
    expect(mergeStepCounterWithLive(model, live)).toBe(120)
  })

  it('a live window that overlaps no model window adds on top', () => {
    const live: StepCountWindow[] = [{ startMs: 500_000, endMs: 560_000, steps: 33 }]
    expect(mergeStepCounterWithLive(model, live)).toBe(106 + 33)
  })

  it('partial overlap drops the whole overlapped model window (Tier-2 wins the span)', () => {
    // Live window 30s–90s straddles the boundary of the first two 60s model windows,
    // so BOTH are dropped in favour of the live count; only the third remains.
    const live: StepCountWindow[] = [{ startMs: 30_000, endMs: 90_000, steps: 25 }]
    expect(mergeStepCounterWithLive(model, live)).toBe(25 + 10)
  })

  it('an empty model with a standalone live window still credits the live steps', () => {
    expect(mergeStepCounterWithLive([], [{ startMs: 0, endMs: 60_000, steps: 42 }])).toBe(42)
  })
})

// The 2026-07-28 step over-count: a live-counted window claimed 3,605 steps in 13 minutes and, via
// the Tier-2-wins override, turned a real 1,578-step day into a displayed 4,903.
describe('isPlausibleStepWindow — physical cadence ceiling', () => {
  const min = (n: number) => n * 60_000

  it('rejects the real window that caused the over-count (3,605 steps in 13 min = 288/min)', () => {
    expect(isPlausibleStepWindow(3605, 0, min(13))).toBe(false)
  })

  it('rejects the worst stored window (1,716 steps in 1.5 min = 1,145/min)', () => {
    expect(isPlausibleStepWindow(1716, 0, min(1.5))).toBe(false)
  })

  it('accepts a brisk real walk (150 steps/min)', () => {
    expect(isPlausibleStepWindow(1500, 0, min(10))).toBe(true)
  })

  it('accepts a count sitting exactly on the ceiling', () => {
    expect(isPlausibleStepWindow(MAX_PLAUSIBLE_STEPS_PER_SEC * 600, 0, min(10))).toBe(true)
  })

  it('tolerates a couple of boundary strides on a short window', () => {
    // A 10 s window at the ceiling is 28 steps; the grace must not make the gate useless...
    expect(isPlausibleStepWindow(30, 0, 10_000)).toBe(true)
    expect(isPlausibleStepWindow(60, 0, 10_000)).toBe(false)
  })

  it('rejects a zero-length or inverted window rather than dividing by zero', () => {
    expect(isPlausibleStepWindow(10, 0, 0)).toBe(false)
    expect(isPlausibleStepWindow(10, 60_000, 0)).toBe(false)
  })

  it('accepts a still window with no steps', () => {
    expect(isPlausibleStepWindow(0, 0, min(30))).toBe(true)
  })
})

describe('mergeStepCounterWithLive — implausible live windows must not override the model', () => {
  // Mirrors the real 2026-07-28 shape: the model covers the span, one bogus live window overlaps it.
  const model: StepCountWindow[] = [
    { startMs: 0, endMs: 600_000, steps: 300 },
    { startMs: 600_000, endMs: 1_200_000, steps: 400 },
  ]

  it('falls back to the model for the span an impossible window claimed', () => {
    const live: StepCountWindow[] = [{ startMs: 0, endMs: 780_000, steps: 3605 }]
    // Without the guard this returned 3,605 + 0 uncovered = 3,605. Now both model windows survive.
    expect(mergeStepCounterWithLive(model, live)).toBe(700)
  })

  it('still lets a plausible live window win its span', () => {
    const live: StepCountWindow[] = [{ startMs: 0, endMs: 600_000, steps: 900 }]
    expect(mergeStepCounterWithLive(model, live)).toBe(1300) // 900 live + 400 uncovered model
  })

  it('drops only the impossible window when both kinds are present', () => {
    const live: StepCountWindow[] = [
      { startMs: 0, endMs: 600_000, steps: 900 },        // plausible → wins its span
      { startMs: 600_000, endMs: 660_000, steps: 5000 }, // impossible → dropped
    ]
    expect(mergeStepCounterWithLive(model, live)).toBe(1300)
  })
})

// Production holds 15 overlapping pairs of live windows — `upsertStepLiveWindow` conflicts on
// (userId, startDs) alone, so a retry landing a decisecond later inserts a SECOND row instead of
// replacing the first. Summing them counts the same span twice.
describe('dedupeOverlappingWindows', () => {
  it('never sums two windows covering the same span', () => {
    // The real shape: starts 1 ds apart, near-identical spans.
    const out = dedupeOverlappingWindows([
      { startMs: 838116200, endMs: 838361100, steps: 2 },
      { startMs: 838116300, endMs: 838361200, steps: 27 },
    ])
    expect(out).toHaveLength(1)
    expect(out[0].steps).toBe(27) // the larger survives
  })

  it('keeps windows that merely touch end-to-end', () => {
    const out = dedupeOverlappingWindows([
      { startMs: 0, endMs: 60_000, steps: 100 },
      { startMs: 60_000, endMs: 120_000, steps: 90 },
    ])
    expect(out).toHaveLength(2)
  })

  it('resolves the real production cluster without double-counting', () => {
    // ds 8413105-8415985: four ~4-min windows plus two shorter ones inside them.
    const cluster: StepCountWindow[] = [
      { startMs: 841310500, endMs: 841555400, steps: 16 },
      { startMs: 841310600, endMs: 841555500, steps: 7 },
      { startMs: 841310700, endMs: 841555600, steps: 17 },
      { startMs: 841310800, endMs: 841555700, steps: 34 },
      { startMs: 841331500, endMs: 841456600, steps: 175 },
      { startMs: 841468700, endMs: 841598500, steps: 126 },
    ]
    const total = dedupeOverlappingWindows(cluster).reduce((s, w) => s + w.steps, 0)
    expect(cluster.reduce((s, w) => s + w.steps, 0)).toBe(375) // what the plain sum credited
    expect(total).toBe(301) // 175 + 126, the two non-overlapping bests
  })

  it('can only lower a total, never raise one', () => {
    const windows: StepCountWindow[] = [
      { startMs: 0, endMs: 60_000, steps: 50 },
      { startMs: 30_000, endMs: 90_000, steps: 40 },
      { startMs: 120_000, endMs: 180_000, steps: 30 },
    ]
    const before = windows.reduce((s, w) => s + w.steps, 0)
    const after = dedupeOverlappingWindows(windows).reduce((s, w) => s + w.steps, 0)
    expect(after).toBeLessThanOrEqual(before)
    expect(after).toBe(80) // 50 + 30; the overlapping 40 is dropped
  })
})

describe('mergeStepCounterWithLive — overlapping live windows', () => {
  it('does not credit the same span twice', () => {
    const model: StepCountWindow[] = [{ startMs: 0, endMs: 600_000, steps: 100 }]
    const live: StepCountWindow[] = [
      { startMs: 0, endMs: 300_000, steps: 400 },
      { startMs: 100, endMs: 300_100, steps: 390 }, // duplicate row, 1 ds later
    ]
    expect(mergeStepCounterWithLive(model, live)).toBe(400) // not 790
  })
})
