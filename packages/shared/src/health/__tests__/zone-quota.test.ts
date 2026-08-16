import { describe, it, expect } from 'vitest'
import { computeZoneQuota, weekWindow } from '../zone-quota'

describe('computeZoneQuota', () => {
  const targets = [
    { zoneId: 1 as const, minutes: 30 },
    { zoneId: 2 as const, minutes: 108 },
    { zoneId: 3 as const, minutes: 8 },
    { zoneId: 4 as const, minutes: 5 },
    { zoneId: 5 as const, minutes: 0 },
  ]

  it('subtracts accumulated seconds from the weekly target', () => {
    // Two days: Z2 gets 40min + 34min = 74min of a 108min target.
    const days = [
      { day: '2026-07-20', seconds: [1800, 2400, 180, 60, 0] as [number, number, number, number, number] },
      { day: '2026-07-21', seconds: [1800, 2040, 120, 60, 0] as [number, number, number, number, number] },
    ]
    const q = computeZoneQuota(targets, days)
    const z2 = q.zones.find(z => z.zoneId === 2)!
    expect(z2.targetMin).toBe(108)
    expect(z2.doneMin).toBe(74)
    expect(z2.remainingMin).toBe(34)
    expect(z2.pctComplete).toBe(69) // round(74/108*100)
    expect(z2.status).toBe('open')
  })

  it('marks a zone complete and never reports negative remaining', () => {
    const days = [{ day: '2026-07-20', seconds: [2400, 0, 0, 0, 0] as [number, number, number, number, number] }]
    const q = computeZoneQuota(targets, days)
    const z1 = q.zones.find(z => z.zoneId === 1)!
    expect(z1.doneMin).toBe(40)
    expect(z1.remainingMin).toBe(0)   // not -10
    expect(z1.pctComplete).toBe(100)  // capped
    expect(z1.status).toBe('complete')
  })

  it('marks a zero-target zone as not-required, not complete', () => {
    const q = computeZoneQuota(targets, [])
    const z5 = q.zones.find(z => z.zoneId === 5)!
    expect(z5.status).toBe('not-required')
    expect(z5.pctComplete).toBe(0)
  })

  it('reports training zones (Z2+) separately from passively-filled Z1', () => {
    const days = [{ day: '2026-07-20', seconds: [1800, 2400, 480, 300, 0] as [number, number, number, number, number] }]
    const q = computeZoneQuota(targets, days)
    // Z2 40 + Z3 8 + Z4 5 = 53 done of 108+8+5 = 121 target
    expect(q.trainingDoneMin).toBe(53)
    expect(q.trainingTargetMin).toBe(121)
    expect(q.trainingRemainingMin).toBe(68)
  })

  it('handles an empty week', () => {
    const q = computeZoneQuota(targets, [])
    expect(q.trainingDoneMin).toBe(0)
    expect(q.zones.find(z => z.zoneId === 2)!.remainingMin).toBe(108)
  })
})

describe('weekWindow', () => {
  it('returns the local week start through today, inclusive', () => {
    const w = weekWindow('2026-07-22', '2026-07-20')
    expect(w.from).toBe('2026-07-20')
    expect(w.to).toBe('2026-07-22')
  })

  it('never returns a window ending before it starts', () => {
    // Defensive: a caller passing a stale week start must not invert the range.
    const w = weekWindow('2026-07-19', '2026-07-20')
    expect(w.from).toBe('2026-07-19')
    expect(w.to).toBe('2026-07-19')
  })
})
