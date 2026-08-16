import { describe, it, expect } from 'vitest'
import { clampToDenseSensing, denseSensingSpan } from '@/lib/sleep/sensing-span'

const EPOCH_DS = 5 * 60 * 10
const ds = (min: number) => min * 60 * 10

describe('denseSensingSpan', () => {
  it('drops an isolated dense-but-awake evening burst, keeping the sleep run (2026-07-15 beats)', () => {
    // Real per-epoch beat counts from the owner's 2026-07-15 dump, window start 19:53. Epochs 0–2 are
    // a dense awake burst (638/623/512), 3–25 are sparse evening spot-readings (≤129), and real sleep
    // is the long dense run from epoch 26 (22:03). The span must be the sleep, not the 3-epoch burst.
    const beats = [
      638, 623, 512, 0, 0, 92, 56, 59, 68, 88, 76, 95, 81, 91, 43, 49, 22, 36, 2, 0, 0, 0, 6, 77, 107, 114, // 0–25 (19:53–21:58)
      545, 633, 640, 390, 327, 317, 304, 328, 318, 314, 311, 315, 318, 324, 321, 324, 318, 323, // 26–43 (22:03–23:28)
      318, 318, 323, 320, 328, 308, 312, 315, 305, 295, 306, 303, 298, 300, 306, 289, 282, 287, // 44–61
      306, 304, 291, 309, 333, 372, 366, 342, 307, 354, 315, 336, 320, 353, 316, 278, 273, 275, 277, // 62–80
      276, 268, 268, 273, 265, 264, 257, 270, 290, 290, 293, 288, 312, 306, 309, 294, 330, 336, 358, // 81–99
      312, 329, 348, 316, 312, 317, 290, 277, 288, 288, 287, 276, 289, 284, 300, 323, 324, 330, 347, 325, // 100–119
      306, 295, 0, 238, 530, 573, 297, 44, // 120–127 (05:58–06:33): 06:08 is a 1-epoch gap, bridged
    ]
    const span = denseSensingSpan(beats)
    expect(span).not.toBeNull()
    expect(span!.start).toBe(26)  // 22:03 — real bedtime, not the 19:53 burst
    expect(span!.end).toBe(126)   // 06:28 (the 06:08 zero is bridged; 06:33's 44 beats drops off)
  })

  it('spans BOTH clusters of a genuinely split night (a real mid-night gap, not an evening burst)', () => {
    // Two substantial sleep clusters (12 epochs each) separated by a 10-epoch dead gap. Both are real
    // sleep, so the span must cover from the first to the last — not collapse to one cluster.
    const beats = [...Array(12).fill(300), ...Array(10).fill(0), ...Array(12).fill(300)]
    const span = denseSensingSpan(beats)
    expect(span).toEqual({ start: 0, end: 33 })
  })

  it('drops a substantial-but-short evening-activity burst hours before sleep (2026-07-21)', () => {
    // Real 07-21 dump shape: a 6-epoch dense evening burst at 17:19–17:44 (~500 beats), then ~46 sparse
    // spot-reading epochs, then ~100 epochs of dense real sleep from ~21:39. The burst clears minRun (6)
    // so it's "substantial", but it's tiny vs the ~100-epoch sleep run — so the span must START at the
    // sleep (epoch 52), not span back to 17:19 (which read as a 13h / 5:53pm "night").
    const beats = [
      533, 0, 0, 490, 527, 306,   // 0–5: evening-activity burst (bridged over the two 0 epochs)
      ...Array(46).fill(20),       // 6–51: sparse evening spot-readings
      ...Array(100).fill(300),     // 52–151: real continuous sleep
    ]
    const span = denseSensingSpan(beats)
    expect(span).toEqual({ start: 52, end: 151 })
  })

  it('finds the single sleep run on a clean night (2026-07-14 shape)', () => {
    const beats = [
      97, 0, 85, 0, 20, 0, 129, 2, 1, 0, 12, 113, 114, 114, 92, 54, 0, 0, 27, 104, 91, 75, 83, // 0–22 sparse
      469, 693, 691, 456, 354, 351, 342, 336, 348, 348, 342, 354, 354, 356, 360, 340, 330, 324, // 23+ dense
    ]
    const span = denseSensingSpan(beats)
    expect(span!.start).toBe(23)
    expect(span!.end).toBe(beats.length - 1)
  })

  it('bridges an asymmetric interruption instead of dropping the earlier real sleep bout (2026-08-03/04)', () => {
    // Real per-epoch beat counts from the owner's 2026-08-03→04 night (decoded from the actual raw
    // BLE samples): dense sleep 22:32–00:42 (26 epochs, up to 623 beats), a phone-call interruption
    // 00:42–00:57 (3 non-dense epochs), then dense sleep again 00:57–07:39ish (80 epochs). The first
    // bout is only ~0.33x the second — below minNeighborRatio — but the 3-epoch gap is far under
    // maxBridgeGapEpochs, so the span must cover both bouts with the gap as interior awake time, not
    // truncate to the second bout alone (which read as a 00:59 bedtime, ~2h10m of real sleep lost).
    const boutA = [447, 618, 623, 391, 299, 305, 294, 300, 300, 304, 300, 294, 294, 288, 294, 280, 275, 284, 292, 281, 271, 276, 291, 288, 298, 265] // 26 epochs
    const gap = [0, 0, 41] // 3 epochs, well under threshold (0.3 * 623 = 187)
    const boutB = Array(80).fill(280) // 80 epochs, comparable to the real ~6h40m second bout
    const beats = [...boutA, ...gap, ...boutB]
    const span = denseSensingSpan(beats)
    expect(span).toEqual({ start: 0, end: beats.length - 1 })
  })

  it('returns null when no substantial dense run exists (all sparse or empty)', () => {
    expect(denseSensingSpan([0, 0, 0, 0])).toBeNull()
    expect(denseSensingSpan([])).toBeNull()
    // A lone short dense burst (< minRunEpochs) with nothing else is not sleep.
    expect(denseSensingSpan([500, 500, ...Array(20).fill(10)])).toBeNull()
  })
})

describe('clampToDenseSensing', () => {
  it('clamps the window to the dense sleep run (2026-07-15: 19:53 window → 22:03 bedtime)', () => {
    const window = { startDs: ds(19 * 60 + 53), endDs: ds((24 + 6) * 60 + 38) } // 19:53 → 06:38 next day
    const beats = [640, 100, ...Array(24).fill(50), ...Array(80).fill(320)] // epoch 0 burst, 26+ dense
    const clamped = clampToDenseSensing(window, beats, EPOCH_DS)
    expect(clamped.startDs).toBe(window.startDs + 26 * EPOCH_DS) // 22:03
    expect(clamped.startDs).toBe(ds(22 * 60 + 3))
  })

  it('leaves the window untouched when there is no HR (never trims to nothing)', () => {
    const window = { startDs: ds(1300), endDs: ds(1800) }
    expect(clampToDenseSensing(window, [0, 0, 0], EPOCH_DS)).toEqual(window)
  })

  it('is a no-op when the whole window is uniformly dense', () => {
    const window = { startDs: ds(1300), endDs: ds(1800) }
    const clamped = clampToDenseSensing(window, Array(6).fill(300), EPOCH_DS)
    expect(clamped.startDs).toBe(window.startDs)
  })
})
