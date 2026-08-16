// Q-24 §7: the two direct-BLE ingest routes filtered each field against its own band and never
// reconciled the fields against each other or against the clock that produced them.
import { describe, it, expect } from 'vitest'
import { rrContradictsBpm } from '@trainingai/shared/validation/plausibility'
import { resolveMeasuredAt } from '@trainingai/shared/validation/ingest-clock'
import { toAestDay, todayInTz } from '@trainingai/shared/date-utils'

describe('rrContradictsBpm — a packet must agree with itself', () => {
  it('accepts intervals that match the reported rate', () => {
    // 60 bpm is a 1,000 ms interval.
    expect(rrContradictsBpm([980, 1010, 995, 1020], 60)).toBe(false)
  })

  it('accepts the ordinary divergence between a smoothed bpm and instantaneous intervals', () => {
    // Intervals imply ~75 bpm against a reported 60 — real through a rising effort, inside ±50%.
    expect(rrContradictsBpm([800, 800, 800], 60)).toBe(false)
  })

  it('rejects intervals implying triple the reported rate', () => {
    // ~200 bpm of intervals on a packet reporting 60.
    expect(rrContradictsBpm([300, 300, 300], 60)).toBe(true)
  })

  it('rejects intervals implying a third of the reported rate', () => {
    // ~30 bpm of intervals on a packet reporting 150.
    expect(rrContradictsBpm([2000, 2000], 150)).toBe(true)
  })

  it('does not judge a packet whose own bpm is out of band', () => {
    // bpm=0 during strap-on acquisition: there is nothing trustworthy to compare against, and
    // rejecting here would drop RR data over a field that is already filtered separately.
    expect(rrContradictsBpm([980, 1010], 0)).toBe(false)
  })

  it('does not judge a packet with no in-band intervals at all', () => {
    expect(rrContradictsBpm([5, 9_999_999], 60)).toBe(false)
  })

  it('ignores out-of-band artifacts when averaging', () => {
    // One 5 ms artifact among good beats must not drag the mean into a rejection.
    expect(rrContradictsBpm([1000, 1000, 5, 1000], 60)).toBe(false)
  })
})

describe('the RR backwards walk', () => {
  // Mirrors the route's cursor loop. The bug: `rr` is `z.number().int()`, so a NEGATIVE artifact
  // walked the cursor FORWARD past the packet timestamp, planting later beats in the future where
  // the inWindow filter — which only ever sees `s.at` — could not reach them.
  const RR_MIN = 200, RR_MAX = 4000, RR_WALK_MAX_MS = 60_000
  const walk = (at: number, rr: number[], guarded: boolean) => {
    const out: number[] = []
    let end = at
    for (let i = rr.length - 1; i >= 0; i--) {
      const rrMs = rr[i]
      if (rrMs >= RR_MIN && rrMs <= RR_MAX) out.push(end)
      if (guarded) { if (rrMs > 0 && rrMs <= RR_WALK_MAX_MS) end -= rrMs }
      else end -= rrMs
    }
    return out
  }

  const at = 1_800_000_000_000

  it('reproduces the unguarded walk planting beats in the future', () => {
    const stamps = walk(at, [1000, -600_000, 1000], false)
    expect(Math.max(...stamps)).toBeGreaterThan(at)
  })

  it('keeps every beat at or before the packet timestamp once guarded', () => {
    const stamps = walk(at, [1000, -600_000, 1000], true)
    expect(Math.max(...stamps)).toBeLessThanOrEqual(at)
  })

  it('still lets a real but out-of-band gap move the cursor', () => {
    // A 5 s interval is not a heartbeat, but it IS elapsed time — the beat before it must be
    // stamped 5 s earlier, not on top of it.
    const stamps = walk(at, [1000, 5000, 1000], true)
    expect(stamps[0]).toBe(at)          // the last beat lands on the packet timestamp
    expect(stamps[1]).toBe(at - 6000)   // 5,000 skipped-but-real + its own 1,000
  })
})

describe('resolveMeasuredAt — a weigh-in cannot be filed years out', () => {
  const now = new Date('2026-07-29T10:00:00Z')

  it('keeps an ordinary timestamp', () => {
    const t = new Date('2026-07-29T09:58:00Z')
    expect(resolveMeasuredAt(t.toISOString(), now)).toEqual(t)
  })

  it('keeps a reading queued offline a couple of days ago', () => {
    const t = new Date('2026-07-27T07:12:00Z')
    expect(resolveMeasuredAt(t.toISOString(), now)).toEqual(t)
  })

  it('falls back to server time for a clock years in the past', () => {
    expect(resolveMeasuredAt('2019-01-01T00:00:00Z', now)).toEqual(now)
  })

  it('falls back to server time for a clock in the future', () => {
    expect(resolveMeasuredAt('2027-01-01T00:00:00Z', now)).toEqual(now)
  })

  it('falls back to server time when absent, as before', () => {
    expect(resolveMeasuredAt(undefined, now)).toEqual(now)
  })
})

// Q-25(b): the scale routes archived the raw sample under its real `measuredAt` but keyed the
// body_metrics trend row on todayInTz() — so a weigh-in captured while the phone was offline and
// pushed later overwrote today's real weight and left its own day blank. `resolveMeasuredAt`
// accepts a measuredAt up to 7 days old, so the misfiling window was a full week, not an edge.
// Both /api/scale-ble/samples and the pending-confirm route now key off the measured day.
describe('a weigh-in is filed on the day it was taken', () => {
  const TZ = 'Australia/Brisbane'

  it('keeps a backdated reading on its own local day, not the day it was pushed', () => {
    const now = new Date('2026-07-29T02:00:00Z')          // 12:00 on the 29th, Brisbane
    const takenYesterday = '2026-07-27T22:00:00Z'          // 08:00 on the 28th, Brisbane
    const resolved = resolveMeasuredAt(takenYesterday, now)

    expect(toAestDay(resolved, TZ)).toBe('2026-07-28')
    expect(toAestDay(resolved, TZ)).not.toBe(todayInTz(TZ))
  })

  // The UTC-vs-local trap this codebase keeps re-learning: before 10:00 Brisbane the UTC date is
  // still yesterday, so a naive toISOString().slice(0,10) files the reading a day early.
  it('uses the local day for a reading taken before 10am Brisbane', () => {
    const now = new Date('2026-07-29T00:30:00Z')           // 10:30 on the 29th, Brisbane
    const earlyMorning = '2026-07-28T23:30:00Z'            // 09:30 on the 29th, Brisbane
    const resolved = resolveMeasuredAt(earlyMorning, now)

    expect(toAestDay(resolved, TZ)).toBe('2026-07-29')
    expect(toAestDay(resolved, 'UTC')).toBe('2026-07-28') // what UTC keying would have filed it as
  })

  // A measuredAt outside the tolerance falls back to `now`, which must still resolve to now's
  // local day — the fallback must not reintroduce the bug it exists to bound.
  it('files an out-of-tolerance measuredAt on the receiving day', () => {
    const now = new Date('2026-07-29T02:00:00Z')
    const ancient = '2019-01-01T00:00:00Z'
    expect(toAestDay(resolveMeasuredAt(ancient, now), TZ)).toBe(toAestDay(now, TZ))
  })
})
