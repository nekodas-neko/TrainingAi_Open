import { describe, expect, it, beforeEach, vi } from 'vitest'
import { readStrapBattery, writeStrapBattery, MIN_WINDOW_MS } from '../strap-battery'

/**
 * BF-215 — the chip reads 100 until the cell is nearly dead, because the one number that predicts
 * failure is the one it never shows.
 *
 * A CR2025 cannot recharge, so production's `100 → 30 → 100` is not a state of charge: it is the
 * cell drooping under a sustained BLE session and recovering at rest. The sag only happens while
 * the owner is training and not looking at Home; by the time he looks, it reads 100 again.
 *
 * **The entry's recommendation was "the lowest reading from the most recent connected SESSION",
 * and that would be a no-op.** `PolarGattClient.readBattery` is called once, from the
 * descriptor-write callback when HR notifications are enabled — there is no periodic re-read — so
 * the value cannot move inside a session and a within-session minimum is the reading itself. It
 * moves across CONNECTIONS, which is what this tracks.
 */
const store = new Map<string, string>()
const DAY = 24 * 60 * 60 * 1000
const T0 = 1_700_000_000_000

beforeEach(() => {
  store.clear()
  vi.stubGlobal('window', {
    localStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => { store.set(k, v) },
    },
  })
})

describe('BF-215 — the low-water mark', () => {
  it('keeps the sag after the cell recovers, which is the whole defect', () => {
    writeStrapBattery(100, T0)
    writeStrapBattery(30, T0 + DAY)        // under load, mid-workout
    writeStrapBattery(100, T0 + 2 * DAY)   // at rest, which is when he looks
    const r = readStrapBattery()!
    expect(r.percent, 'the latest reading is still the latest').toBe(100)
    expect(r.min, 'and the chip draws THIS one').toBe(30)
    expect(r.minAt).toBe(T0 + DAY)
  })

  it('moves down but never up inside the window', () => {
    writeStrapBattery(60, T0)
    writeStrapBattery(45, T0 + DAY)
    writeStrapBattery(80, T0 + 2 * DAY)
    expect(readStrapBattery()!.min).toBe(45)
  })

  it('forgets a mark older than the window, so a replaced cell clears itself', () => {
    // Nothing can detect a cell change — a fresh CR2025 and a dying one both read 100 at rest — so
    // the window is what stops a stale 30 outliving the cell it described.
    writeStrapBattery(30, T0)
    writeStrapBattery(100, T0 + MIN_WINDOW_MS + 1)
    const r = readStrapBattery()!
    expect(r.min).toBe(100)
    expect(r.minAt).toBe(T0 + MIN_WINDOW_MS + 1)
  })

  it('holds the mark right up to the window edge', () => {
    writeStrapBattery(30, T0)
    writeStrapBattery(100, T0 + MIN_WINDOW_MS)
    expect(readStrapBattery()!.min, 'exactly at the edge is still inside it').toBe(30)
  })

  it('reads a pre-BF-215 entry as its own mark rather than dropping it', () => {
    store.set('ta_strap_battery_v1', JSON.stringify({ percent: 55, at: T0 }))
    expect(readStrapBattery()).toEqual({ percent: 55, at: T0, min: 55, minAt: T0 })
  })

  it('ignores an implausible reading without disturbing the mark', () => {
    writeStrapBattery(30, T0)
    writeStrapBattery(0, T0 + 60_000)
    writeStrapBattery(null, T0 + 120_000)
    const r = readStrapBattery()!
    expect(r.min, 'a strap that has not finished its first read reports 0 or null').toBe(30)
    expect(r.percent).toBe(30)
  })
})
