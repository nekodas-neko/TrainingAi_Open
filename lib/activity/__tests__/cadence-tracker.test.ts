import { describe, it, expect } from 'vitest'
import {
  pickLiveCadence,
  STRAP_STALE_MS,
  RING_STALE_MS,
  RING_MIN_RECORD_GAP_MS,
  dateRingWindows,
  ringWindowsWithin,
} from '@/lib/activity/cadence-tracker'
import { summarizeCadence, RING_CADENCE_VALIDATED, type CadenceReading } from '@trainingai/shared/health/cadence'

const NOW = 1_000_000

describe('pickLiveCadence', () => {
  it('prefers the strap when both are fresh — it updates ~30x more often', () => {
    const picked = pickLiveCadence({ spm: 160, atMs: NOW - 1000 }, { spm: 172, atMs: NOW - 500 }, NOW)
    expect(picked).toEqual({ spm: 172, source: 'strap' })
  })

  it('falls back to the ring only while the ring is a validated cadence source', () => {
    // Written against the flag rather than the current value, so restoring the ring flips
    // this back to asserting the fallback without anyone having to remember to edit it.
    const picked = pickLiveCadence({ spm: 160, atMs: NOW - 1000 }, null, NOW)
    if (RING_CADENCE_VALIDATED) expect(picked).toEqual({ spm: 160, source: 'ring' })
    else expect(picked).toBeNull()
  })

  it('reports nothing rather than a ring number while the ring is gated off', () => {
    // On-device the ring gave ~1.0 Hz for walks 1.8x apart in cadence — a number that does
    // not move with pace. Silence is the honest output until that is fixed.
    if (RING_CADENCE_VALIDATED) return
    expect(pickLiveCadence({ spm: 160, atMs: NOW }, null, NOW)).toBeNull()
  })

  it('never keeps a stale strap reading, whatever the ring is doing', () => {
    // A dropped BLE stream must not leave the display pinned at the last pace seen.
    const stale = { spm: 172, atMs: NOW - STRAP_STALE_MS - 1 }
    const picked = pickLiveCadence({ spm: 160, atMs: NOW - 1000 }, stale, NOW)
    expect(picked?.source).not.toBe('strap')
    if (RING_CADENCE_VALIDATED) expect(picked).toEqual({ spm: 160, source: 'ring' })
    else expect(picked).toBeNull()
  })

  it('keeps the strap right up to the staleness boundary', () => {
    const edge = { spm: 172, atMs: NOW - STRAP_STALE_MS }
    expect(pickLiveCadence(null, edge, NOW)?.source).toBe('strap')
  })

  it('tolerates two missed ring windows before dropping the ring', () => {
    if (!RING_CADENCE_VALIDATED) return // ring fallback is gated off; nothing to tolerate
    expect(pickLiveCadence({ spm: 160, atMs: NOW - RING_STALE_MS }, null, NOW)?.source).toBe('ring')
    expect(pickLiveCadence({ spm: 160, atMs: NOW - RING_STALE_MS - 1 }, null, NOW)).toBeNull()
  })

  it('reports nothing when both are stale or absent — never a stale number', () => {
    expect(pickLiveCadence(null, null, NOW)).toBeNull()
    expect(pickLiveCadence(
      { spm: 160, atMs: NOW - RING_STALE_MS - 1 },
      { spm: 172, atMs: NOW - STRAP_STALE_MS - 1 },
      NOW,
    )).toBeNull()
  })
})

/**
 * The ring's native service drains its history buffer hourly, so a drain hands the tracker a
 * burst of windows covering the whole preceding hour in one go. Reproduces the shape of that
 * burst against the two guards that now exist: newest-ds-wins, and a minimum record gap.
 */
describe('ring drain-burst handling', () => {
  const START = 1_000_000

  /** Mirrors the tracker's guards without needing the BLE plugin. */
  function recordBurst(windows: Array<{ ds: number; spm: number }>, arrivalMs: number) {
    const readings: CadenceReading[] = []
    let lastDs: number | null = null
    let lastRecordAt = -Infinity
    let burstIdx: number | null = null
    for (const w of windows) {
      if (lastDs !== null && w.ds < lastDs) continue      // older-than-newest: history
      lastDs = w.ds
      if (arrivalMs - lastRecordAt >= RING_MIN_RECORD_GAP_MS) {
        lastRecordAt = arrivalMs
        burstIdx = readings.length
        readings.push({ atMs: arrivalMs, spm: w.spm, source: 'ring' })
      } else if (burstIdx !== null && readings.length > burstIdx) {
        // Same burst, newer window: supersede rather than append or drop.
        readings.length = burstIdx
        readings.push({ atMs: arrivalMs, spm: w.spm, source: 'ring' })
      }
    }
    return readings
  }

  it('an hour-long drain burst contributes ONE reading, not a hundred', () => {
    // 120 windows, 30 s apart in ring time, all delivered in the same millisecond.
    const burst = Array.from({ length: 120 }, (_, i) => ({ ds: i * 300, spm: 100 + i }))
    const readings = recordBurst(burst, START)
    expect(readings).toHaveLength(1)
    // ...and it is the NEWEST window, the only one that describes the present.
    expect(readings[0].spm).toBe(219)
  })

  it('a stale window arriving after a newer one is ignored', () => {
    const readings = recordBurst([{ ds: 900, spm: 170 }, { ds: 300, spm: 90 }], START)
    expect(readings).toHaveLength(1)
    expect(readings[0].spm).toBe(170)
  })

  it('genuine windows ~30s apart in real time are all recorded', () => {
    const readings: CadenceReading[] = []
    let lastRecordAt = -Infinity
    for (let i = 0; i < 4; i++) {
      const at = START + i * 30_000
      if (at - lastRecordAt >= RING_MIN_RECORD_GAP_MS) {
        lastRecordAt = at
        readings.push({ atMs: at, spm: 170, source: 'ring' })
      }
    }
    expect(readings).toHaveLength(4)
  })

  it('without the guards, a burst would have swamped the activity average', () => {
    // Regression intent: 120 stale windows averaging ~160 alongside one real 100 spm walk
    // reading would have pulled the saved average far off the pace actually walked.
    const swamped = summarizeCadence(
      [
        { atMs: START, spm: 100, source: 'ring' },
        ...Array.from({ length: 120 }, (_, i) => ({
          atMs: START, spm: 100 + i, source: 'ring' as const,
        })),
      ],
      START,
    )
    expect(swamped.avgSpm).toBeGreaterThan(155)

    const guarded = summarizeCadence(
      [{ atMs: START, spm: 100, source: 'ring' }],
      START,
    )
    expect(guarded.avgSpm).toBe(100)
  })
})

// Reproduces the owner's 2026-07-27 150 bpm capture, where the ring drain landed 16 s into a
// 147 s capture. The previous ds-offset scoping anchored on the newest window and reached
// 147 s BACKWARDS from it, so ~87% of the windows it called "in capture" predated the walk.
describe('ring window dating and capture scoping', () => {
  const START = 1_785_129_945_634
  const END = START + 146_700
  const DRAIN_AT = START + 18_600 // drain landed 13% into the capture

  // ds counts up in deciseconds; the newest window occurred at ~the drain moment.
  const NEWEST_DS = 18_923_022
  const win = (dsBack: number, strideHz: number) => ({
    ds: NEWEST_DS - dsBack,
    strideHz,
    state: 'walk',
    receivedAtMs: DRAIN_AT,
  })

  it('dates windows backwards from the drain, not from the capture end', () => {
    const dated = dateRingWindows([win(0, 2.5), win(300, 2.4), win(600, 2.3)])
    expect(dated[0].occurredAtMs).toBe(DRAIN_AT)
    expect(dated[1].occurredAtMs).toBe(DRAIN_AT - 30_000)
    expect(dated[2].occurredAtMs).toBe(DRAIN_AT - 60_000)
  })

  it('excludes windows that predate the capture even though their ds is near the newest', () => {
    // 30 s and 60 s before the drain are both BEFORE the capture started (drain was 18.6 s in).
    const windows = [win(0, 2.5), win(300, 2.4), win(600, 2.3), win(900, 1.2)]
    const inCapture = ringWindowsWithin(windows, START, END)
    expect(inCapture).toHaveLength(1)
    expect(inCapture[0].ds).toBe(NEWEST_DS)
  })

  it('the old ds-offset scoping would have wrongly kept all of them', () => {
    const windows = [win(0, 2.5), win(300, 2.4), win(600, 2.3), win(900, 1.2)]
    const captureDs = Math.round(((END - START) / 1000) * 10)
    const newestDs = Math.max(...windows.map(w => w.ds))
    const oldScoping = windows.filter(w => w.ds >= newestDs - captureDs)
    expect(oldScoping).toHaveLength(4) // the bug: pre-capture history counted as capture data
    expect(ringWindowsWithin(windows, START, END).length).toBeLessThan(oldScoping.length)
  })

  it('keeps every window when the drain lands at the end of the capture', () => {
    const atEnd = (dsBack: number, strideHz: number) => ({
      ds: NEWEST_DS - dsBack, strideHz, state: 'walk', receivedAtMs: END,
    })
    const windows = [atEnd(0, 2.5), atEnd(300, 2.4), atEnd(600, 2.3), atEnd(900, 2.45)]
    expect(ringWindowsWithin(windows, START, END)).toHaveLength(4)
  })

  it('returns nothing rather than throwing on an empty window list', () => {
    expect(dateRingWindows([])).toEqual([])
    expect(ringWindowsWithin([], START, END)).toEqual([])
  })
})
