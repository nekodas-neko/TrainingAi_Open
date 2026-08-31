// BF-81. `oura_daily_derived`'s three daytime-stress scalars and the bucket strip were written by
// two different computations of the same metric: the rollup persisted the buckets from
// `latest.rhrLowBpm` + `nightHrvMs`, while `/api/body-battery` persisted the scalars from its own
// series built off `restingHr` + a 28-day HRV mean. Measured in production over the eight days
// carrying both, the SIGN disagreed on six and high-stress minutes by 4–8×, so a user reading the
// strip and the number was reading two different days.
//
// The rollup now writes both from one series. What these pin is the property that makes that worth
// doing — the scalars must be a reduction OF the buckets, not a parallel opinion about them.
import { describe, it, expect } from 'vitest'
import { summarizeStressDay, STRESS_HIGH_LEVEL, RECOVERY_HIGH_LEVEL, STRESS_BUCKET_MS } from '@/lib/health/daytime-stress'

const pt = (t: number, stressLevel: number) => ({ t, stressLevel, dhrv: 0 })
const bucketMin = STRESS_BUCKET_MS / 60_000

describe('the stress scalars reduce the same series as the buckets', () => {
  it('means the level over every bucket, so the sign follows the strip', () => {
    const series = [pt(0, -0.6), pt(1, -0.8), pt(2, -0.4), pt(3, 0.6)]
    const s = summarizeStressDay(series)!
    expect(s.daytimeStressScaled).toBeLessThan(0)
    expect(s.daytimeStressScaled).toBe(Math.round((-0.6 - 0.8 - 0.4 + 0.6) / 4 * 100) / 100)
  })

  it('counts high-stress minutes at the same threshold the strip is drawn with', () => {
    const series = [pt(0, STRESS_HIGH_LEVEL), pt(1, STRESS_HIGH_LEVEL - 0.1), pt(2, STRESS_HIGH_LEVEL + 0.1)]
    expect(summarizeStressDay(series)!.stressHighMinutes).toBe(2 * bucketMin)
  })

  it('counts recovery minutes at its own threshold, inclusively', () => {
    const series = [pt(0, RECOVERY_HIGH_LEVEL), pt(1, RECOVERY_HIGH_LEVEL + 0.2), pt(2, RECOVERY_HIGH_LEVEL - 0.1)]
    expect(summarizeStressDay(series)!.recoveryHighMinutes).toBe(2 * bucketMin)
  })

  // The two producers disagreed most on exactly this: the route reported 0–60 min of high stress on
  // days the buckets said 2–4.5 hours. A day that is entirely stressed must not summarise to zero.
  it('does not report zero high-stress minutes for a day that is entirely high stress', () => {
    const series = Array.from({ length: 18 }, (_, i) => pt(i, -0.9))
    const s = summarizeStressDay(series)!
    expect(s.stressHighMinutes).toBe(18 * bucketMin)
    expect(s.daytimeStressScaled).toBeLessThan(STRESS_HIGH_LEVEL)
  })

  // A day with no scored buckets writes nothing, so a sparse pass cannot clobber a good value.
  it('returns null for an empty series rather than a zeroed day', () => {
    expect(summarizeStressDay([])).toBeNull()
  })
})
