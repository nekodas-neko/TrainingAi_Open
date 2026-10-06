// #2457 / #2299 v2: HRR60 exists only where the series is dense enough to see the minute after a set.
import { describe, it, expect } from 'vitest'
import { deriveHrr60, restAdequateFromHrr60 } from '../hrr60'
import { planHrr1Backfill, summariseHrr1Changes } from '../hrr1-backfill'

const END = 1_000_000
type R = { timestamp: Date; bpm: number; source?: string | null }
const at = (offsetMs: number, bpm: number, source: string | null = 'chest_strap'): R =>
  ({ timestamp: new Date(END + offsetMs), bpm, source })
/** 1 Hz from `fromS` to `toS` seconds after the set end, falling 1 bpm a second from 150. */
const strap = (fromS = 0, toS = 60, source: string | null = 'chest_strap') =>
  Array.from({ length: toS - fromS + 1 }, (_, k) => at((fromS + k) * 1000, 150 - (fromS + k), source))

describe('deriveHrr60', () => {
  it('measures HR(end) − HR(end + 60 s) from a 1 Hz strap series', () => {
    expect(deriveHrr60(strap(), END)).toEqual({ bpm: 60, source: 'chest_strap' })
  })

  it('accepts anchors up to 3 s off and rejects 4 s', () => {
    const shifted = strap(3, 57) // nearest readings sit exactly 3 s inside each anchor
    expect(deriveHrr60(shifted, END)?.bpm).toBe(54)
    expect(deriveHrr60(strap(4, 60), END)).toBeNull()
    expect(deriveHrr60(strap(0, 56), END)).toBeNull()
  })

  it('accepts a 5 s gap and rejects a 6 s gap between the anchors', () => {
    const five = strap().filter(r => { const s = (r.timestamp.getTime() - END) / 1000; return s <= 20 || s >= 25 })
    expect(deriveHrr60(five, END)?.bpm).toBe(60)
    const six = strap().filter(r => { const s = (r.timestamp.getTime() - END) / 1000; return s <= 20 || s >= 26 })
    expect(deriveHrr60(six, END)).toBeNull()
  })

  it('rejects ring-density points even when both anchors are hit exactly', () => {
    const ring = [at(0, 110, 'ble'), at(30_000, 100, 'ble'), at(60_000, 95, 'ble')]
    expect(deriveHrr60(ring, END)).toBeNull()
  })

  it('reads unsorted input the same as sorted', () => {
    expect(deriveHrr60([...strap()].reverse(), END)?.bpm).toBe(60)
  })

  it('reports mixed provenance when the anchors come from different devices', () => {
    const s = strap()
    s[60] = { ...s[60], source: 'watch' }
    expect(deriveHrr60(s, END)?.source).toBe('mixed')
  })

  it('never throws: empty, null end, non-finite values all give null', () => {
    expect(deriveHrr60([], END)).toBeNull()
    expect(deriveHrr60(strap(), null)).toBeNull()
    expect(deriveHrr60(strap(), Number.NaN)).toBeNull()
    expect(deriveHrr60([at(0, Number.NaN), at(60_000, 90)], END)).toBeNull()
    expect(deriveHrr60([{ timestamp: new Date(Number.NaN), bpm: 100 }], END)).toBeNull()
  })

  it('a negative recovery (HR still climbing) is a real value, not null', () => {
    const climbing = Array.from({ length: 61 }, (_, k) => at(k * 1000, 100 + Math.floor(k / 20)))
    expect(deriveHrr60(climbing, END)?.bpm).toBe(-3)
  })
})

describe('restAdequateFromHrr60', () => {
  it('is null with no measurement, otherwise the 15 bpm bar', () => {
    expect(restAdequateFromHrr60(null)).toBeNull()
    expect(restAdequateFromHrr60(14)).toBe(false)
    expect(restAdequateFromHrr60(15)).toBe(true)
  })
})

describe('planHrr1Backfill', () => {
  const row = (id: string, offsetMs: number, before: { hrr1Bpm: number | null; restAdequate: boolean | null }) =>
    ({ setLogId: id, loggedAt: new Date(END + offsetMs), ...before })

  it('fills a measurable row, clears a stale ring verdict, and leaves a settled row alone', () => {
    const readings = [...strap(), at(600_000, 90, 'ble'), at(900_000, 85, 'ble')]
    const changes = planHrr1Backfill([
      row('strap', 0, { hrr1Bpm: null, restAdequate: false }),        // old rule said cross; dense says 60
      row('ring', 600_000, { hrr1Bpm: null, restAdequate: false }),   // ring-only: verdict must clear
      row('done', 0, { hrr1Bpm: 60, restAdequate: true }),            // already right
      row('none', 2_000_000, { hrr1Bpm: null, restAdequate: null }),  // no series, nothing to change
    ], readings)
    expect(changes.map(c => [c.setLogId, c.after])).toEqual([
      ['strap', { hrr1Bpm: 60, restAdequate: true }],
      ['ring', { hrr1Bpm: null, restAdequate: null }],
    ])
    expect(summariseHrr1Changes(changes)).toEqual({
      rowsChanged: 2, gainedHrr1: 1,
      verdictTransitions: { 'inadequate -> adequate': 1, 'inadequate -> none': 1 },
    })
  })

  it('a row with no logged_at is re-measured as null', () => {
    const changes = planHrr1Backfill([{ setLogId: 'x', loggedAt: null, hrr1Bpm: null, restAdequate: true }], strap())
    expect(changes[0].after).toEqual({ hrr1Bpm: null, restAdequate: null })
  })
})
