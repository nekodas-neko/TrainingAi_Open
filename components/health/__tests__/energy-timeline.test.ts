import { describe, it, expect } from 'vitest'
import { buildEnergyTimeline, type HrBucket, type IntakeEvent } from '../energy-timeline'

const DAY = Date.UTC(2026, 7, 19, 14, 0, 0) // 2026-08-20 00:00 Brisbane
const hourMs = (h: number) => DAY + h * 3_600_000

/** `n` consecutive 15-minute buckets at `bpm`, starting at `hour` — the day-log payload's shape. */
function hrAt(hour: number, bpm: number, n = 1): HrBucket[] {
  return Array.from({ length: n }, (_, k) => ({ minute: hour * 60 + k * 15, bpm }))
}

const BASE = {
  dayStartMs: DAY,
  restingHr: 60,
  restingBaseKcal: 1_680,
  activeKcal: 480,
  intake: [] as IntakeEvent[],
}

describe('buildEnergyTimeline', () => {
  /**
   * The property the whole design rests on. The curve is a *partition* of the day's already
   * computed figures, so it must land on them exactly — a chart that disagrees with the number
   * printed above it is worse than no chart (Q-414), and Q-401 exists because two TDEE models
   * differed by 271 kcal.
   */
  it('the burn curve ends exactly on restingBase + active, whatever the HR shape', () => {
    for (const hr of [
      hrAt(9, 130, 4),
      [...hrAt(3, 55, 4), ...hrAt(18, 90, 4)],
      [...hrAt(0, 61), ...hrAt(23, 200)],
      [],
    ]) {
      const t = buildEnergyTimeline({ ...BASE, hr })
      expect(t.totals.burnKcal).toBeCloseTo(1_680 + 480, 6)
      expect(t.buckets.at(-1)!.burnCumKcal).toBeCloseTo(1_680 + 480, 6)
    }
  })

  it('the intake curve ends exactly on the calories eaten', () => {
    const intake = [
      { atMs: hourMs(8), kcal: 420 },
      { atMs: hourMs(13), kcal: 700 },
      { atMs: hourMs(19), kcal: 880 },
    ]
    const t = buildEnergyTimeline({ ...BASE, hr: hrAt(9, 120, 4), intake })
    expect(t.totals.intakeKcal).toBe(2_000)
    expect(t.buckets.at(-1)!.intakeCumKcal).toBe(2_000)
  })

  it('puts the active energy where the heart rate was, not spread evenly', () => {
    // All the elevated HR sits in hour 9; hour 3 is at resting and must earn nothing active.
    const t = buildEnergyTimeline({ ...BASE, hr: [...hrAt(3, 60, 4), ...hrAt(9, 140, 4)] })
    const flat = 1_680 / 24
    expect(t.buckets[3].burnKcal).toBeCloseTo(flat, 6)      // BMR only
    expect(t.buckets[9].burnKcal).toBeCloseTo(flat + 480, 6) // BMR + all of the active term
  })

  /**
   * **This pins a modelling error, not a coding one, and it was nearly shipped.** The first draft
   * weighted by the SUM of elevation over the readings in a bucket, reasoning that the ring samples
   * more often when you move, so density is evidence. That holds within one source and breaks
   * across two: measured over 14 days the chest strap logged 26,034 samples to the ring's 3,810,
   * and it is worn only during workouts. Weighting by count would hand a strap-worn workout on the
   * order of a hundred times the energy of an equally long, equally intense ring-only walk.
   *
   * Equal-width buckets at the same mean elevation must therefore earn the same energy, however
   * many readings each was assembled from.
   */
  it('weights by mean elevation, so a densely-sampled source cannot out-vote a sparse one', () => {
    const t = buildEnergyTimeline({ ...BASE, hr: [...hrAt(7, 100, 1), ...hrAt(9, 100, 4)] })
    const flat = 1_680 / 24
    const active7 = t.buckets[7].burnKcal - flat
    const active9 = t.buckets[9].burnKcal - flat
    expect(active9 / active7).toBeCloseTo(1, 6)
  })

  it('still ranks a harder hour above an easier one', () => {
    // Guards the obvious over-correction: equalising for density must not equalise for intensity.
    const t = buildEnergyTimeline({ ...BASE, hr: [...hrAt(7, 80, 4), ...hrAt(9, 140, 4)] })
    const flat = 1_680 / 24
    expect(t.buckets[9].burnKcal - flat).toBeCloseTo((t.buckets[7].burnKcal - flat) * 4, 6)
  })

  it('ignores samples at or below resting rather than letting them borrow active energy', () => {
    const t = buildEnergyTimeline({ ...BASE, hr: [...hrAt(2, 45, 4), ...hrAt(9, 140, 4)] })
    expect(t.buckets[2].burnKcal).toBeCloseTo(1_680 / 24, 6)
    expect(t.buckets[2].hrGap).toBe(false) // readings landed; they just carried no active weight
  })

  it('spreads the active term flat when no sample clears resting, rather than dropping it', () => {
    // Dropping it would break reconciliation, which is the one thing that must not happen.
    const t = buildEnergyTimeline({ ...BASE, hr: hrAt(4, 50, 4) })
    expect(t.totals.burnKcal).toBeCloseTo(2_160, 6)
    for (const b of t.buckets) expect(b.burnKcal).toBeCloseTo(2_160 / 24, 6)
  })

  it('flags the hours with no HR reading, so the chart can say so instead of implying zero', () => {
    const t = buildEnergyTimeline({ ...BASE, hr: hrAt(9, 120, 3) })
    expect(t.hrGapBuckets).toBe(23)
    expect(t.buckets[9].hrGap).toBe(false)
    expect(t.buckets[10].hrGap).toBe(true)
  })

  it('drops readings and meals outside the day rather than folding them into an edge bucket', () => {
    const t = buildEnergyTimeline({
      ...BASE,
      hr: [...hrAt(-3, 150, 4), ...hrAt(30, 150, 4), ...hrAt(9, 120, 4)],
      intake: [{ atMs: hourMs(-1), kcal: 500 }, { atMs: hourMs(12), kcal: 300 }],
    })
    expect(t.totals.intakeKcal).toBe(300)
    // Yesterday's exercise must not land in hour 0, nor tomorrow's in hour 23.
    expect(t.buckets[0].burnKcal).toBeCloseTo(1_680 / 24, 6)
    expect(t.buckets[23].burnKcal).toBeCloseTo(1_680 / 24, 6)
  })

  it('honours a finer bucket width without changing what the day totals', () => {
    const intake = [{ atMs: hourMs(8) + 20 * 60_000, kcal: 400 }]
    const t = buildEnergyTimeline({ ...BASE, hr: hrAt(9, 120, 4), intake, bucketMinutes: 15 })
    expect(t.buckets).toHaveLength(96)
    expect(t.buckets[33].intakeKcal).toBe(400) // 08:15–08:30
    expect(t.totals.burnKcal).toBeCloseTo(2_160, 6)
  })
})
