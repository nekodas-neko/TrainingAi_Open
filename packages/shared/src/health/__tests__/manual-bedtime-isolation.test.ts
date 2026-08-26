// Q-519 — a remembered bedtime must move the bedtime estimate and NOTHING else.
//
// The original design wrote it into `sleep_start` at `manual` rank, on the stated grounds that
// duration, time-in-bed and efficiency are stored columns rather than derived from the span. The
// audit that entry commissioned found otherwise
// (`docs/reviews/2026-08-26-manual-bedtime-write-audit.md`): `aggregateNight` recomputes time-in-bed
// from `sleepEnd − sleepStart` and efficiency from that, the daytime-HRV model decides which samples
// are "nightly" by window membership, and `primaryCluster` unions same-date rows within an hour of
// the window. On the owner's own reported night — 04:23→08:03, 3 h 5 m — a remembered 23:00 gave
// **9.05 h at 34% efficiency**.
//
// So the value lives in its own column, and these pin what that buys: the measured window stays
// measured. **The fragmented-night case is the one that matters** — it is the exact shape that
// produced 34%, and it is the shape a single-window test cannot reach.
import { describe, it, expect } from 'vitest'
import { nightSessions, aggregateNight, groupSleepPeriods, type AggregatableSleep } from '../sleep-night'

const TZ = 'Australia/Brisbane'

type Night = AggregatableSleep & {
  durationHours: number
  efficiency?: number | null
  timeInBedHours?: number | null
  manualSleepStart?: Date | null
}

/** The owner's reported night: the ring was fitted at ~4 am and recorded 3 h 5 m. */
const measured = (over: Partial<Night> = {}): Night => ({
  date: '2026-08-19',
  sleepStart: new Date('2026-08-18T18:23:00.000Z'),  // 04:23 Brisbane
  sleepEnd:   new Date('2026-08-18T22:03:00.000Z'),  // 08:03 Brisbane
  durationHours: 3.08,
  efficiency: 84,
  timeInBedHours: 3.67,
  ...over,
} as Night)

/** A short doze after the main bout — the fragment shape Q-274 measures in production. Two windows
 *  is what makes `aggregateNight` recompute instead of returning the row untouched. */
const morningDoze = (): Night => measured({
  sleepStart: new Date('2026-08-18T22:30:00.000Z'),  // 08:30 Brisbane
  sleepEnd:   new Date('2026-08-18T23:00:00.000Z'),  // 09:00
  durationHours: 0.4, efficiency: 80, timeInBedHours: 0.5,
})

/** 23:00 Brisbane the night before — what the owner actually remembers. */
const REMEMBERED = new Date('2026-08-18T13:00:00.000Z')

describe('a remembered bedtime does not touch the measured window', () => {
  it('leaves a single night byte-identical apart from the field itself', () => {
    const plain = nightSessions([measured()], TZ)[0]
    const withManual = nightSessions([measured({ manualSleepStart: REMEMBERED })], TZ)[0]

    expect(withManual.sleepStart).toEqual(plain.sleepStart)
    expect(withManual.sleepEnd).toEqual(plain.sleepEnd)
    expect(withManual.durationHours).toBe(plain.durationHours)
    expect((withManual as Night).efficiency).toBe((plain as Night).efficiency)
    expect((withManual as Night).timeInBedHours).toBe((plain as Night).timeInBedHours)
  })

  // The case that produced the 34%. `aggregateNight` returns a one-window night untouched, so only a
  // fragmented one reaches the recomputation — and Q-274 measures ten fragment rows in production,
  // several of them exactly this shape: a short doze after the main bout.
  it('leaves a FRAGMENTED night at its measured efficiency', () => {
    const plain = nightSessions([measured(), morningDoze()], TZ)
    const withManual = nightSessions(
      [measured({ manualSleepStart: REMEMBERED }), morningDoze()], TZ)

    expect(plain).toHaveLength(1)
    expect(withManual).toHaveLength(1)
    const a = plain[0] as Night, b = withManual[0] as Night

    expect(b.timeInBedHours).toBe(a.timeInBedHours)
    expect(b.efficiency).toBe(a.efficiency)
    expect(b.durationHours).toBe(a.durationHours)
    expect(b.sleepStart).toEqual(a.sleepStart)

    // Time-in-bed stays the observed span rather than the ten hours a remembered 23:00 implies.
    expect(a.timeInBedHours!).toBeLessThan(6)
    expect(a.efficiency!).toBeGreaterThan(50)
  })

  // The rejected design, run, so the review's number is checkable rather than quoted — and so this
  // file fails loudly if anyone reinstates it.
  it('reproduces what writing sleep_start would have done to the same night', () => {
    const asIfWritten = measured({ sleepStart: REMEMBERED })   // sleep_start overwritten at rank 5
    const [bad] = nightSessions([asIfWritten, morningDoze()], TZ) as Night[]
    const [good] = nightSessions([measured(), morningDoze()], TZ) as Night[]

    // Exact, not approximate: these are the numbers the review quotes, and pinning them means a
    // change to the aggregation that alters either one has to be looked at rather than absorbed.
    expect(bad.timeInBedHours).toBeCloseTo(10.0, 2)     // 23:00 → 09:00
    expect(bad.efficiency).toBe(35)                      // 3.48 h asleep in 10 h
    expect(good.timeInBedHours).toBeCloseTo(4.617, 2)   // 04:23 → 09:00, as measured
    expect(good.efficiency).toBe(75)
    // Same night, same measured sleep. Twice the time in bed, less than half the efficiency.
    expect(bad.durationHours).toBe(good.durationHours)
  })
})

describe('the field survives aggregation, so the estimate can read it', () => {
  it('carries through a single-window night', () => {
    const [n] = nightSessions([measured({ manualSleepStart: REMEMBERED })], TZ) as Night[]
    expect(n.manualSleepStart).toEqual(REMEMBERED)
  })

  // The aggregate takes `...first`, so the value must be on the night's FIRST window to survive —
  // which is what the bedtime estimate depends on, and is why it reads after aggregation rather
  // than before.
  it('carries through a fragmented night from its first window', () => {
    const period = groupSleepPeriods(
      [measured({ manualSleepStart: REMEMBERED }), morningDoze()], TZ).nights[0]
    expect((aggregateNight(period) as Night).manualSleepStart).toEqual(REMEMBERED)
  })

  it('is absent, not fabricated, when nothing was entered', () => {
    const [n] = nightSessions([measured()], TZ) as Night[]
    expect(n.manualSleepStart ?? null).toBeNull()
  })
})
