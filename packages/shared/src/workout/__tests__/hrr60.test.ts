// #2457 / #2299 v2: HRR60 exists only where the series is dense enough to see the minute after a set.
import { describe, it, expect } from 'vitest'
import { deriveHrr60, deriveHrrAt, personalHrr60Bar, restAdequateFromHrr60, withHrr60Recovery, HRR60_BAR_MIN_SETS } from '../hrr60'
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
  const NO_DROPS = { drop30s: null, drop60s: null, drop90s: null, drop120s: null }
  const row = (id: string, offsetMs: number, before: { hrr1Bpm: number | null; restAdequate: boolean | null; drop30s?: number | null; drop60s?: number | null }) =>
    ({ setLogId: id, loggedAt: new Date(END + offsetMs), ...NO_DROPS, ...before })

  it('fills a measurable row, clears a stale ring verdict, and leaves a settled row alone', () => {
    const readings = [...strap(), at(600_000, 90, 'ble'), at(900_000, 85, 'ble')]
    const changes = planHrr1Backfill([
      row('strap', 0, { hrr1Bpm: null, restAdequate: false }),        // old rule said cross; dense says 60
      row('ring', 600_000, { hrr1Bpm: null, restAdequate: false }),   // ring-only: verdict must clear
      row('done', 0, { hrr1Bpm: 60, restAdequate: true }),            // already right
      row('none', 2_000_000, { hrr1Bpm: null, restAdequate: null }),  // no series, nothing to change
    ], readings)
    expect(changes.map(c => [c.setLogId, c.after])).toEqual([
      ['strap', { hrr1Bpm: 60, restAdequate: true, ...NO_DROPS }],
      ['ring', { hrr1Bpm: null, restAdequate: null, ...NO_DROPS }],
    ])
    expect(summariseHrr1Changes(changes)).toEqual({
      rowsChanged: 2, gainedHrr1: 1, drop60sCleared: 0,
      verdictTransitions: { 'inadequate -> adequate': 1, 'inadequate -> none': 1 },
    })
  })

  it('a row with no logged_at is re-measured as null', () => {
    const changes = planHrr1Backfill([{ setLogId: 'x', loggedAt: null, hrr1Bpm: null, restAdequate: true, ...NO_DROPS }], strap())
    expect(changes[0].after).toEqual({ hrr1Bpm: null, restAdequate: null, ...NO_DROPS })
  })

  // #2601: the stored drop curve goes through the same dense rule. A ring set's drop clears; a
  // strap set's takes the dense value; an offset the row never had stays empty.
  it('gates each stored drop on the dense rule, and keeps a null a null', () => {
    const readings = [...strap(0, 60), at(600_000, 90, 'ble'), at(630_000, 90, 'ble'), at(660_000, 90, 'ble')]
    const changes = planHrr1Backfill([
      row('strap', 0, { hrr1Bpm: 60, restAdequate: true, drop30s: 28, drop60s: 59 }),
      row('ring', 600_000, { hrr1Bpm: null, restAdequate: null, drop30s: 0, drop60s: 0 }),
    ], readings)
    expect(changes.map(c => [c.setLogId, c.after.drop30s, c.after.drop60s, c.after.drop90s])).toEqual([
      ['strap', 30, 60, null],
      ['ring', null, null, null],
    ])
    expect(summariseHrr1Changes(changes).drop60sCleared).toBe(1)
  })

  it('decides the verdict against the bar it is given', () => {
    // HRR60 is 60 here; a bar of 61 makes it a cross.
    const [c] = planHrr1Backfill([row('s', 0, { hrr1Bpm: 60, restAdequate: true })], strap(), () => 61)
    expect(c.after.restAdequate).toBe(false)
  })
})

describe('deriveHrrAt (#2601)', () => {
  it('is HRR60 at 60 s, and the same rule at any offset', () => {
    const s = strap(0, 120)
    expect(deriveHrrAt(s, END, 60_000)).toEqual(deriveHrr60(s, END))
    expect(deriveHrrAt(s, END, 30_000)?.bpm).toBe(30)
    expect(deriveHrrAt(s, END, 120_000)?.bpm).toBe(120)
    expect(deriveHrrAt(strap(0, 60), END, 90_000)).toBeNull()
    expect(deriveHrrAt(s, END, 0)).toBeNull()
  })
})

describe('personalHrr60Bar (#2299 step 2)', () => {
  const n = (len: number, v: number) => Array.from({ length: len }, () => v)
  it(`keeps the population 15 until ${HRR60_BAR_MIN_SETS} measured sets exist`, () => {
    expect(personalHrr60Bar(n(HRR60_BAR_MIN_SETS - 1, 8))).toBe(15)
    expect(personalHrr60Bar(n(HRR60_BAR_MIN_SETS, 8))).toBe(8)
  })
  it('is the median, clamped to 5–15: never harsher than 15', () => {
    expect(personalHrr60Bar([...n(10, 9), ...n(10, 11)])).toBe(10)
    expect(personalHrr60Bar(n(25, 30))).toBe(15)
    expect(personalHrr60Bar(n(25, 2))).toBe(5)
  })
  it('ignores non-finite values', () => {
    expect(personalHrr60Bar([...n(19, 8), Number.NaN])).toBe(15)
  })
})

describe('withHrr60Recovery — the live recap (#2299 step 2)', () => {
  it('replaces the nearest-reading hrr1 with HRR60 and judges it against the bar', () => {
    const stats = [
      { setEndMs: END, loggedAt: new Date(END), hrr1: 12, adequate: false },
      // A ring-only set: the old rule had a value; HRR60 has none, so no mark.
      { setEndMs: END + 600_000, loggedAt: new Date(END + 600_000), hrr1: 3, adequate: false },
    ]
    const readings = [...strap(), at(600_000, 110, 'ble'), at(660_000, 107, 'ble')]
    expect(withHrr60Recovery(stats, readings, 10).map(s => [s.hrr1, s.adequate])).toEqual([[60, true], [null, null]])
    expect(withHrr60Recovery(stats, readings, 61)[0].adequate).toBe(false)
  })
})
