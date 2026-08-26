// Q-512 — `health-insight` handed `computeVolumeAcwr` a SEVEN-day session list, and the helper
// measures its span from the earliest session in the list it is given, against a 21-day gate. So
// ACWR was null there on 110 of 110 days: not a coverage problem more history would fix, a
// structural one. These pin the property that makes it structural, so the mis-wiring cannot come
// back by someone shortening a window and seeing tests stay green.
import { describe, it, expect } from 'vitest'
import { computeVolumeAcwr } from '../acwr'

const TODAY = new Date('2026-08-26T00:00:00.000Z')
const daysAgo = (n: number) => new Date(TODAY.getTime() - n * 86_400_000)

/** Sessions every other day across `spanDays`, each 5000 kg — well over the 100 kg/week floor. */
const series = (spanDays: number) =>
  Array.from({ length: Math.floor(spanDays / 2) + 1 }, (_, i) => ({
    startedAt: daysAgo(spanDays - i * 2),
    volumeKg: 5000,
  }))

describe('computeVolumeAcwr — the window decides whether ACWR can exist at all', () => {
  // The defect, stated as a property: no 7-day list can ever clear a 21-day span gate, however
  // many sessions it holds or how much volume they carry.
  it('is null for a 7-day list no matter how dense it is', () => {
    const dense = Array.from({ length: 14 }, (_, i) => ({ startedAt: daysAgo(i / 2), volumeKg: 5000 }))
    expect(computeVolumeAcwr(dense, TODAY).acwr).toBeNull()
  })

  it('computes for a 28-day list, which is what the fix widens to', () => {
    expect(computeVolumeAcwr(series(28), TODAY).acwr).not.toBeNull()
  })

  // The gate is right and must not be lowered to rescue a mis-wired caller — that would degrade
  // every other caller's ACWR to fix one. Pinned so the tempting fix fails loudly.
  it('sits exactly on the documented 21-day boundary', () => {
    expect(computeVolumeAcwr(series(20), TODAY).acwr).toBeNull()
    expect(computeVolumeAcwr(series(21), TODAY).acwr).not.toBeNull()
  })

  // What the health-insight route ACTUALLY reads — the entry said `.acwr`, and it does not. This is
  // the volume-lane denominator of the activity score, it is NOT gated, and it was being computed
  // as a median over one week instead of four.
  it('returns typicalSessionVolumeKg even when the ACWR gate fails, so a narrow window silently skews it', () => {
    const week = computeVolumeAcwr(
      [{ startedAt: daysAgo(1), volumeKg: 9000 }, { startedAt: daysAgo(3), volumeKg: 9000 }], TODAY)
    expect(week.acwr).toBeNull()
    expect(week.typicalSessionVolumeKg).toBe(9000)   // an unrepresentative fortnight sets the median

    const month = computeVolumeAcwr(
      [...series(28).map(s => ({ ...s, volumeKg: 5000 })),
       { startedAt: daysAgo(1), volumeKg: 9000 }, { startedAt: daysAgo(3), volumeKg: 9000 }], TODAY)
    expect(month.typicalSessionVolumeKg).toBe(5000)  // the real median reasserts itself
  })

  it('a zero-volume session never becomes the median', () => {
    const r = computeVolumeAcwr(
      [{ startedAt: daysAgo(1), volumeKg: 0 }, { startedAt: daysAgo(2), volumeKg: 4000 }], TODAY)
    expect(r.typicalSessionVolumeKg).toBe(4000)
  })
})
