import { describe, it, expect } from 'vitest'
import {
  computeSleepScore,
  computeSleepScoreSeries,
  sleepComponentsToContributors,
  sleepScoreBaselines,
  SLEEP_AUTONOMIC_BASELINE_WINDOW_NIGHTS,
} from '@trainingai/shared/health/sleep-score'
import type { SleepSession } from '@trainingai/shared/types/body'

const TZ = 'Australia/Brisbane' // UTC+10, no DST

// A base night whose Brisbane-local midpoint sits at ~03:00 (13:00→21:00 UTC).
function night(overrides: Partial<SleepSession> = {}): SleepSession {
  return {
    id: 's1',
    userId: 'u1',
    date: '2026-07-09',
    sleepStart: new Date('2026-07-08T13:00:00Z'),
    sleepEnd: new Date('2026-07-08T21:00:00Z'),
    createdAt: new Date('2026-07-09T00:00:00Z'),
    durationHours: 8,
    ...overrides,
  }
}

describe('computeSleepScore', () => {
  it('returns null when there is no duration to score', () => {
    expect(computeSleepScore(night({ durationHours: undefined }), TZ)).toBeNull()
    expect(computeSleepScore(night({ durationHours: 0 }), TZ)).toBeNull()
  })

  it('scores a BLE night (duration + efficiency, no hypnogram) without fabricating stages', () => {
    const r = computeSleepScore(night({ efficiency: 90, remSleepHours: undefined, deepSleepHours: undefined }), TZ)
    expect(r).not.toBeNull()
    expect(r!.score).toBeGreaterThan(0)
    expect(r!.score).toBeLessThanOrEqual(100)
    // Missing stages must be absent, not zero-scored.
    expect(r!.components).not.toHaveProperty('rem')
    expect(r!.components).not.toHaveProperty('deep')
    expect(r!.components).toHaveProperty('totalSleep')
  })

  it('includes REM/Deep contributors when stage hours are present', () => {
    const r = computeSleepScore(night({ efficiency: 90, remSleepHours: 1.5, deepSleepHours: 1.2 }), TZ)
    expect(r!.components).toHaveProperty('rem')
    expect(r!.components).toHaveProperty('deep')
  })

  it('rewards more total sleep monotonically', () => {
    const short = computeSleepScore(night({ durationHours: 5 }), TZ)!
    const long = computeSleepScore(night({ durationHours: 8 }), TZ)!
    expect(long.components.totalSleep).toBeGreaterThan(short.components.totalSleep)
  })

  it('penalises both instant and very long sleep latency (U-curve)', () => {
    const instant = computeSleepScore(night({ onsetLatencySec: 0 }), TZ)!
    const ideal = computeSleepScore(night({ onsetLatencySec: 12 * 60 }), TZ)!
    const long = computeSleepScore(night({ onsetLatencySec: 70 * 60 }), TZ)!
    expect(ideal.components.latency).toBeGreaterThan(instant.components.latency)
    expect(ideal.components.latency).toBeGreaterThan(long.components.latency)
  })

  it('peaks the timing contributor at a ~03:00 midpoint', () => {
    const onThree = computeSleepScore(night(), TZ)! // midpoint 03:00 Brisbane
    // Shift the whole window 4h later → midpoint ~07:00, further from the circadian ideal.
    const late = computeSleepScore(night({
      sleepStart: new Date('2026-07-08T17:00:00Z'),
      sleepEnd: new Date('2026-07-09T01:00:00Z'),
    }), TZ)!
    expect(onThree.components.timing).toBeGreaterThan(late.components.timing)
  })

  it('reserves 90+ for exceptional nights — a normal-good night lands below it', () => {
    // Recalibration guard (session 245): 7.6h, 90% eff, 12-min latency, low restlessness, no
    // stages (a BLE night) previously scored 94; the compressed curves should now keep a
    // very-good-but-normal night comfortably under 90.
    const good = computeSleepScore(night({
      durationHours: 7.6, efficiency: 90, onsetLatencySec: 12 * 60, restlessPeriods: 8,
    }), TZ)!
    expect(good.score).toBeLessThan(90)
    // A genuinely exceptional night (long, efficient, good stages, ideal timing) can still reach high.
    const exceptional = computeSleepScore(night({
      durationHours: 8.5, efficiency: 96, onsetLatencySec: 12 * 60, restlessPeriods: 2,
      remSleepHours: 1.7, deepSleepHours: 1.6,
    }), TZ)!
    expect(exceptional.score).toBeGreaterThan(good.score)
  })

  // Q-3: `restlessPeriods` is no longer scored. The column carries Oura's restlessness measure on
  // Cloud nights (138–330 here) and a 0–5 awakenings count on BLE nights — two different quantities
  // in one column, which no single curve can serve. The old curve topped out at 50, so every Cloud
  // night clamped to the maximum 32-point penalty while BLE nights drew ≤2.5.
  it('ignores restlessPeriods entirely, on either era\'s scale', () => {
    const base = { efficiency: 92, awakHours: 0.5 }
    const none = computeSleepScore(night({ ...base, restlessPeriods: null }), TZ)!
    const bleScale = computeSleepScore(night({ ...base, restlessPeriods: 5 }), TZ)!
    const cloudScale = computeSleepScore(night({ ...base, restlessPeriods: 330 }), TZ)!
    expect(bleScale.components.restfulness).toBe(none.components.restfulness)
    expect(cloudScale.components.restfulness).toBe(none.components.restfulness)
    expect(cloudScale.score).toBe(bleScale.score)
  })

  it('still lowers restfulness as time spent awake rises', () => {
    // The signal is kept — it just comes from the unit-stable inputs.
    const settled = computeSleepScore(night({ efficiency: 92, awakHours: 0.2 }), TZ)!
    const broken = computeSleepScore(night({ efficiency: 92, awakHours: 1.6 }), TZ)!
    expect(settled.components.restfulness).toBeGreaterThan(broken.components.restfulness)
  })

  it('still lowers restfulness as efficiency drops', () => {
    const efficient = computeSleepScore(night({ efficiency: 96, awakHours: 0.5 }), TZ)!
    const poor = computeSleepScore(night({ efficiency: 78, awakHours: 0.5 }), TZ)!
    expect(efficient.components.restfulness).toBeGreaterThan(poor.components.restfulness)
  })

  // Achievability (2026-07-22 recalibration): a genuinely excellent night must be able to reach the
  // high 90s / 100 — the old curves capped it ~92 because latency/timing could never exceed 98/97.
  it('lets a genuinely excellent night reach the high 90s', () => {
    const excellent = computeSleepScore(night({
      durationHours: 8.5, efficiency: 96, onsetLatencySec: 12 * 60, restlessPeriods: 2,
      remSleepHours: 1.8, deepSleepHours: 1.6,
    }), TZ)!
    expect(excellent.score).toBeGreaterThanOrEqual(96)
  })

  it('puts a near-perfect night with strong HRV at the top of the range without pinning it', () => {
    const perfect = computeSleepScore(night({
      durationHours: 9, efficiency: 98, onsetLatencySec: 12 * 60, restlessPeriods: 0,
      remSleepHours: 2.0, deepSleepHours: 1.7, averageHrvMs: 62,
    }), TZ, { hrvBaselineMs: 55 })!
    // Was `toBe(100)`. The 2026-08-17 recalibration moved the REM ceiling from 2.2 h to 3.0 h, so
    // 2.0 h of REM is now a good-not-maximal 82 rather than a flat 100 — the owner's own MEDIAN is
    // 1.86 h, which is what made the old curve unable to separate any two nights. This night is
    // excellent on every axis and maximal on none, so it belongs just under the ceiling.
    expect(perfect.score).toBeGreaterThanOrEqual(98)
    expect(perfect.score).toBeLessThanOrEqual(100)
  })

  // HRV is opt-in: only present when a baseline is supplied AND the night has an HRV reading.
  it('adds the hrv contributor only when a baseline and a reading are both present', () => {
    const withHrv = computeSleepScore(night({ averageHrvMs: 58 }), TZ, { hrvBaselineMs: 55 })!
    expect(withHrv.components).toHaveProperty('hrv')

    const noBaseline = computeSleepScore(night({ averageHrvMs: 58 }), TZ)!
    expect(noBaseline.components).not.toHaveProperty('hrv')

    const noReading = computeSleepScore(night({ averageHrvMs: undefined }), TZ, { hrvBaselineMs: 55 })!
    expect(noReading.components).not.toHaveProperty('hrv')
  })

  it('scores overnight HRV above the personal baseline higher than below it', () => {
    const above = computeSleepScore(night({ averageHrvMs: 66 }), TZ, { hrvBaselineMs: 55 })!
    const below = computeSleepScore(night({ averageHrvMs: 40 }), TZ, { hrvBaselineMs: 55 })!
    expect(above.components.hrv).toBeGreaterThan(below.components.hrv)
  })
})

describe('sleepComponentsToContributors', () => {
  it('maps component keys onto the Oura Cloud contributor key names', () => {
    expect(sleepComponentsToContributors({
      totalSleep: 90, efficiency: 80, rem: 70, deep: 60, latency: 95, timing: 97, restfulness: 66,
    })).toEqual({
      total_sleep: 90, efficiency: 80, rem_sleep: 70, deep_sleep: 60, latency: 95, timing: 97, restfulness: 66,
    })
  })

  it('omits absent components instead of fabricating them (BLE night without stages)', () => {
    const out = sleepComponentsToContributors({ totalSleep: 85, efficiency: 78, timing: 90 })
    expect(out).toEqual({ total_sleep: 85, efficiency: 78, timing: 90 })
    expect(out).not.toHaveProperty('rem_sleep')
    expect(out).not.toHaveProperty('deep_sleep')
  })

  it('round-trips a real computeSleepScore result', () => {
    const r = computeSleepScore(night({ efficiency: 92, remSleepHours: 1.4, deepSleepHours: 1.1, onsetLatencySec: 12 * 60 }), TZ)!
    const out = sleepComponentsToContributors(r.components)
    expect(out.total_sleep).toBe(r.components.totalSleep)
    expect(out.rem_sleep).toBe(r.components.rem)
    expect(out.deep_sleep).toBe(r.components.deep)
  })
})

// ── 2026-07-27 owner-directed recalibration ────────────────────────────────
// Context: the night of 2026-07-25 was rated "Terrible" by the owner and scored 80. It was normal on
// every contributor the model had and abnormal only in autonomic state and wake time. These pin the
// two new contributors, the shared baseline derivation, and — the owner's explicit constraint — that
// a perfect night can still reach 100.
describe('sleep score — autonomic + schedule contributors', () => {
  const tz = 'Australia/Brisbane' // UTC+10
  /** Local Brisbane time on `day` as a UTC instant. */
  const bne = (day: number, hour: number, min = 0) => new Date(Date.UTC(2026, 6, day, hour - 10, min))

  /** A textbook night: 22:00 (day−1) → 06:00 (day), Brisbane. */
  const night = (day: number, over: Record<string, unknown> = {}) => ({
    date: `2026-07-${String(day).padStart(2, '0')}`,
    sleepStart: bne(day - 1, 22), sleepEnd: bne(day, 6),
    durationHours: 8, efficiency: 95, deepSleepHours: 1.2, remSleepHours: 1.9,
    lightSleepHours: 4.9, awakHours: 0.4, onsetLatencySec: 720, restlessPeriods: 2,
    averageHrvMs: 50, avgHeartRate: 60,
    ...over,
  } as never)

  const priors = Array.from({ length: 10 }, (_, i) => night(i + 1))

  it('derives all four baselines from prior main sleeps', () => {
    const b = sleepScoreBaselines(priors, tz)
    expect(b.hrvBaselineMs).toBe(50)
    expect(b.hrBaselineBpm).toBe(60)
    expect(b.habitualBedHour).toBeCloseTo(22, 5)
    expect(b.habitualWakeHour).toBeCloseTo(6, 5)
  })

  // Q-72. These four exist because the whole existing baseline suite used identical nights, where
  // an all-time mean and a rolling median are the same number — so the baseline being an expanding
  // all-time mean broke ZERO tests when it was changed. Every case below drifts the input, which is
  // the only shape that can tell the two apart.
  describe('autonomic baselines track the RECENT norm, not the whole history (Q-72)', () => {
    /** 24 nights climbing 30 → 76 ms HRV and falling 76 → 53 bpm: a sustained real improvement. */
    const improving = Array.from({ length: 24 }, (_, i) =>
      night(i + 1, { averageHrvMs: 30 + i * 2, avgHeartRate: 76 - i }))

    it('follows a sustained improvement instead of averaging it away', () => {
      // Measured on the owner's real history: HRV rose 24.8 → 62.7 ms over the record. Against an
      // all-time mean every recent night scored 1.3–1.8× "better than baseline" and pinned at the
      // curve's 100 ceiling — 40 of 44 nights. The baseline must sit near the recent level.
      const b = sleepScoreBaselines(improving, tz)
      const recentHrv = improving.slice(-SLEEP_AUTONOMIC_BASELINE_WINDOW_NIGHTS)
        .map(n => (n as unknown as { averageHrvMs: number }).averageHrvMs)
      const allTimeMean = improving.reduce((a, n) => a + (n as unknown as { averageHrvMs: number }).averageHrvMs, 0) / improving.length

      expect(b.hrvBaselineMs!).toBeGreaterThan(allTimeMean)
      expect(b.hrvBaselineMs!).toBeGreaterThanOrEqual(Math.min(...recentHrv))
      expect(b.hrvBaselineMs!).toBeLessThanOrEqual(Math.max(...recentHrv))
      // Mirror for HR, which improves downward.
      const allTimeHrMean = improving.reduce((a, n) => a + (n as unknown as { avgHeartRate: number }).avgHeartRate, 0) / improving.length
      expect(b.hrBaselineBpm!).toBeLessThan(allTimeHrMean)
    })

    it('stops a TYPICAL night pinning at 100 once the baseline has caught up', () => {
      // The behaviour that matters to the user: after months of improvement, a night at their
      // current norm should read as typical rather than perfect. Under the old all-time mean it
      // scored 100 on both axes, because the mean still sat back where they started.
      //
      // The night is deliberately AT the recent median (HRV 63, HR ~59.5 over the last 14). A
      // night genuinely above the norm still earns 100, which is correct and is why an earlier
      // draft of this test — using HRV 74 — failed for the right reason.
      const b = sleepScoreBaselines(improving, tz)
      expect(b.hrvBaselineMs).toBe(63)
      const typical = computeSleepScore(night(25, { averageHrvMs: 63, avgHeartRate: 60 }), tz, b)!
      expect(typical.components.hrv).toBeLessThan(100)
      expect(typical.components.hr).toBeLessThan(100)

      // And the same night under the OLD all-time-mean baseline pinned both — the regression this
      // guards against, asserted rather than described.
      const allTimeMeanHrv = improving.reduce((a, n) => a + (n as unknown as { averageHrvMs: number }).averageHrvMs, 0) / improving.length
      const allTimeMeanHr = improving.reduce((a, n) => a + (n as unknown as { avgHeartRate: number }).avgHeartRate, 0) / improving.length
      const oldWay = computeSleepScore(night(25, { averageHrvMs: 63, avgHeartRate: 60 }), tz,
        { ...b, hrvBaselineMs: allTimeMeanHrv, hrBaselineBpm: allTimeMeanHr })!
      // Asserted as a RELATION, not as a literal 100: the 2026-08-17 recalibration moved the
      // HRV/HR curves so that scoring your own baseline reads ~70 rather than ~90, and the ceiling
      // now needs a ratio of 1.35 rather than 1.1. The regression being guarded is that a stale
      // all-time-mean baseline INFLATES both contributors against the same night — which is a
      // comparison, and survives any recalibration. Pinning it to 100 only held while the curves
      // saturated early.
      expect(oldWay.components.hrv).toBeGreaterThan(typical.components.hrv)
      expect(oldWay.components.hr).toBeGreaterThan(typical.components.hr)
    })

    it('ignores nights older than the window', () => {
      // A long-ago stretch at a very different physiology must not drag the norm.
      const ancient = Array.from({ length: 30 }, (_, i) => night(i + 1, { averageHrvMs: 20, avgHeartRate: 90 }))
      const recent = Array.from({ length: SLEEP_AUTONOMIC_BASELINE_WINDOW_NIGHTS }, (_, i) =>
        night(i + 1, { averageHrvMs: 60, avgHeartRate: 58 }))
      const b = sleepScoreBaselines([...ancient, ...recent], tz)
      expect(b.hrvBaselineMs).toBe(60)
      expect(b.hrBaselineBpm).toBe(58)
    })

    it('is a median, so one bad night moves the norm barely at all', () => {
      // Illness or travel should not reset what "normal" means.
      const steady = Array.from({ length: SLEEP_AUTONOMIC_BASELINE_WINDOW_NIGHTS - 1 }, (_, i) =>
        night(i + 1, { averageHrvMs: 60, avgHeartRate: 58 }))
      const withOutlier = sleepScoreBaselines([...steady, night(20, { averageHrvMs: 12, avgHeartRate: 95 })], tz)
      expect(withOutlier.hrvBaselineMs).toBe(60)
      expect(withOutlier.hrBaselineBpm).toBe(58)
    })
  })

  it('excludes naps from the baselines — a 45-minute daytime fragment must not move them', () => {
    const nap = night(11, {
      durationHours: 0.75, averageHrvMs: 25, avgHeartRate: 90,
      sleepStart: bne(11, 17), sleepEnd: bne(11, 17, 45),
    })
    const b = sleepScoreBaselines([...priors, nap], tz)
    expect(b.hrvBaselineMs).toBe(50)
    expect(b.hrBaselineBpm).toBe(60)
  })

  it('scores a depressed-HRV / elevated-HR night well below an identical normal one', () => {
    const b = sleepScoreBaselines(priors, tz)
    const normal = computeSleepScore(night(12), tz, b)!
    const bad = computeSleepScore(night(12, { averageHrvMs: 34, avgHeartRate: 72 }), tz, b)!
    expect(normal.score - bad.score).toBeGreaterThanOrEqual(12)
    expect(bad.components.hrv).toBeLessThan(normal.components.hrv)
    expect(bad.components.hr).toBeLessThan(normal.components.hr)
  })

  it('penalises an early wake but NOT an early bedtime', () => {
    const b = sleepScoreBaselines(priors, tz)
    const earlyWake = computeSleepScore(night(12, { sleepEnd: bne(12, 4) }), tz, b)!
    const earlyBed = computeSleepScore(night(12, { sleepStart: bne(11, 20) }), tz, b)!
    expect(earlyWake.components.schedule).toBeLessThan(80)
    expect(earlyBed.components.schedule).toBe(100)
  })

  it('penalises a late bedtime but NOT a lie-in', () => {
    const b = sleepScoreBaselines(priors, tz)
    const lateBed = computeSleepScore(night(12, { sleepStart: bne(12, 0, 30) }), tz, b)!
    const lieIn = computeSleepScore(night(12, { sleepEnd: bne(12, 8) }), tz, b)!
    expect(lateBed.components.schedule).toBeLessThan(80)
    expect(lieIn.components.schedule).toBe(100)
  })

  it('a perfect night still scores 100 with every contributor present', () => {
    const b = sleepScoreBaselines(priors, tz)
    const perfect = computeSleepScore(night(12, {
      sleepStart: bne(11, 22, 30), sleepEnd: bne(12, 7, 30),   // 9 h, 03:00 midpoint
      durationHours: 9, efficiency: 100, deepSleepHours: 1.7, remSleepHours: 2.2,
      awakHours: 0, onsetLatencySec: 720, restlessPeriods: 0,
      averageHrvMs: 55, avgHeartRate: 54,
    }), tz, b)!
    expect(Object.keys(perfect.components).sort()).toEqual(
      ['deep', 'efficiency', 'hr', 'hrv', 'latency', 'rem', 'restfulness', 'schedule', 'timing', 'totalSleep'])
    expect(perfect.score).toBe(100)
  })

  it('scores a whole history against each night\u2019s own priors, newest first', () => {
    const series = computeSleepScoreSeries([...priors, night(11)], tz)
    expect(series).toHaveLength(11)
    expect(series[0].session.date).toBe('2026-07-11')
    // The earliest nights have no baseline yet, so their autonomic contributors are absent.
    expect(series[10].result!.components.hrv).toBeUndefined()
    expect(series[0].result!.components.hrv).toBeDefined()
  })
})

// \u2500\u2500 2026-08-06 owner-directed: awake-time fragmentation cap \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
// Context: a night with repeated work-call wake-ups scored 89 "High" \u2014 normal duration/HRV/HR/
// timing diluted the small efficiency/restfulness hit. The owner explicitly did NOT want
// `sleep_quality_feel` (the morning self-report) driving the score, but wanted an objective
// criterion \u2014 awake time / fragmentation \u2014 able to cap a night regardless of how good everything
// else looked, while never touching a clean night's ability to reach a perfect score.
describe('sleep score \u2014 awake-time fragmentation cap', () => {
  const tz = 'Australia/Brisbane'
  const bne = (day: number, hour: number, min = 0) => new Date(Date.UTC(2026, 6, day, hour - 10, min))

  /** 14 typical nights: ~8h, efficiency mid-90s, ~5% awake fraction with small natural
   * night-to-night variance \u2014 establishes a tight, non-degenerate baseline (a baseline built
   * from identical nights has sd=0, which correctly disables the cap rather than dividing by
   * zero \u2014 realistic data always has some spread). */
  const typicalPriors = Array.from({ length: 14 }, (_, i) => ({
    date: `2026-07-${String(i + 1).padStart(2, '0')}`,
    sleepStart: bne(i + 1, 22), sleepEnd: bne(i + 2, 6),
    durationHours: 7.6, efficiency: 94, awakHours: 0.3 + (i % 3) * 0.1,
  } as unknown as SleepSession))

  it('is absent (baseline null) before enough prior nights exist', () => {
    const b = sleepScoreBaselines(typicalPriors.slice(0, 5), tz)
    expect(b.awakeFractionBaselineMean).toBeNull()
    expect(b.awakeFractionBaselineSd).toBeNull()
  })

  it('matures once enough prior nights carry an awake-time reading', () => {
    const b = sleepScoreBaselines(typicalPriors, tz)
    expect(b.awakeFractionBaselineMean).not.toBeNull()
    expect(b.awakeFractionBaselineSd).not.toBeNull()
  })

  it('does not cap a night within normal range of the baseline', () => {
    const b = sleepScoreBaselines(typicalPriors, tz)
    const normal = computeSleepScore({
      date: '2026-07-16', sleepStart: bne(15, 22), sleepEnd: bne(16, 6),
      durationHours: 7.6, efficiency: 92, awakHours: 0.5,
    } as unknown as SleepSession, tz, b)!
    expect(normal.fragmentationCap).toBeNull()
    expect(normal.score).toBe(normal.preCapScore)
  })

  it('caps a genuine personal outlier below the weighted-blend score', () => {
    const b = sleepScoreBaselines(typicalPriors, tz)
    const fragmented = computeSleepScore({
      date: '2026-07-16', sleepStart: bne(15, 22), sleepEnd: bne(16, 6),
      durationHours: 7.6, efficiency: 80, awakHours: 3.5, // far above baseline awake fraction
    } as unknown as SleepSession, tz, b)!
    expect(fragmented.fragmentationCap).not.toBeNull()
    expect(fragmented.score).toBeLessThan(fragmented.preCapScore)
    expect(fragmented.fragmentationCap!.z).toBeGreaterThan(1.5)
  })

  it('never raises a score above the weighted blend', () => {
    const b = sleepScoreBaselines(typicalPriors, tz)
    // Extremely low awake fraction \u2014 z is very negative, cap curve still tops out at 100.
    const settled = computeSleepScore({
      date: '2026-07-16', sleepStart: bne(15, 22), sleepEnd: bne(16, 6),
      durationHours: 7.6, efficiency: 94, awakHours: 0,
    } as unknown as SleepSession, tz, b)!
    expect(settled.score).toBe(settled.preCapScore)
  })

  it('leaves a genuinely perfect night able to reach 100 (does not lower the ceiling)', () => {
    const b = sleepScoreBaselines(typicalPriors, tz)
    const perfect = computeSleepScore({
      date: '2026-07-16', sleepStart: bne(15, 22, 30), sleepEnd: bne(16, 7, 30),
      durationHours: 9, efficiency: 100, deepSleepHours: 1.7, remSleepHours: 2.2,
      awakHours: 0, onsetLatencySec: 720, restlessPeriods: 0,
    } as unknown as SleepSession, tz, b)!
    expect(perfect.score).toBe(100)
    expect(perfect.fragmentationCap).toBeNull()
  })

  it('does not divide by zero when every prior night has identical awake time (sd=0)', () => {
    const identicalPriors = Array.from({ length: 14 }, (_, i) => ({
      date: `2026-07-${String(i + 1).padStart(2, '0')}`,
      sleepStart: bne(i + 1, 22), sleepEnd: bne(i + 2, 6),
      durationHours: 7.6, efficiency: 94, awakHours: 0.4,
    } as unknown as SleepSession))
    const b = sleepScoreBaselines(identicalPriors, tz)
    expect(b.awakeFractionBaselineSd).toBe(0)
    const anyNight = computeSleepScore({
      date: '2026-07-16', sleepStart: bne(15, 22), sleepEnd: bne(16, 6),
      durationHours: 7.6, efficiency: 80, awakHours: 3.5,
    } as unknown as SleepSession, tz, b)!
    expect(anyNight.fragmentationCap).toBeNull()
    expect(anyNight.score).toBe(anyNight.preCapScore)
  })

  it('does nothing when the night has no awake-time reading at all', () => {
    const b = sleepScoreBaselines(typicalPriors, tz)
    const noReading = computeSleepScore({
      date: '2026-07-16', sleepStart: bne(15, 22), sleepEnd: bne(16, 6),
      durationHours: 7.6, efficiency: 90, awakHours: undefined,
    } as unknown as SleepSession, tz, b)!
    expect(noReading.fragmentationCap).toBeNull()
  })
})
