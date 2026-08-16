import { describe, it, expect } from 'vitest'
import { OuraDailySummaryPushSchema, OuraDailyDerivedPushSchema } from '@trainingai/shared/validation/oura-summary'

// Q-24 §4: the offline push branch accepted any finite number for every field, including the
// six rolling EMA baselines and their shared age counter — the state that drives weeks of
// readiness and illness scores, not just one day.
const night = {
  sleepDurationHours: 7.5, sleepEfficiency: 92, hrvAvgMs: 46, rhrLowBpm: 52,
  tempMeanC: 35.2, tempDevC: 0.3, metAvg: 1.4, breathAvgRpm: 14,
  hrvBaselineMeanX8: 368, hrvBaselineDevX8: 40, nHistory: 21,
}

describe('OuraDailySummaryPushSchema', () => {
  it('accepts an ordinary night', () => {
    expect(OuraDailySummaryPushSchema.safeParse(night).success).toBe(true)
  })

  it('accepts a genuinely bad night — bounds reject the impossible, not the unusual', () => {
    const rough = { ...night, sleepDurationHours: 3.1, sleepEfficiency: 61, hrvAvgMs: 19, rhrLowBpm: 71, tempDevC: 1.4 }
    expect(OuraDailySummaryPushSchema.safeParse(rough).success).toBe(true)
  })

  it('rejects a poisoned baseline', () => {
    expect(OuraDailySummaryPushSchema.safeParse({ ...night, hrvBaselineMeanX8: 1e9 }).success).toBe(false)
    expect(OuraDailySummaryPushSchema.safeParse({ ...night, tempBaselineMeanX8: 999999 }).success).toBe(false)
  })

  it('rejects a negative baseline deviation — a spread cannot be below zero', () => {
    expect(OuraDailySummaryPushSchema.safeParse({ ...night, hrvBaselineDevX8: -5 }).success).toBe(false)
  })

  it('rejects an nHistory that would prematurely un-gate baseline maturity', () => {
    expect(OuraDailySummaryPushSchema.safeParse({ ...night, nHistory: -1 }).success).toBe(false)
    expect(OuraDailySummaryPushSchema.safeParse({ ...night, nHistory: 1e9 }).success).toBe(false)
    expect(OuraDailySummaryPushSchema.safeParse({ ...night, nHistory: 3.5 }).success).toBe(false)
  })

  it('rejects physically impossible measurements', () => {
    expect(OuraDailySummaryPushSchema.safeParse({ ...night, sleepDurationHours: 99 }).success).toBe(false)
    expect(OuraDailySummaryPushSchema.safeParse({ ...night, sleepEfficiency: 5000 }).success).toBe(false)
    expect(OuraDailySummaryPushSchema.safeParse({ ...night, rhrLowBpm: 5 }).success).toBe(false)
    expect(OuraDailySummaryPushSchema.safeParse({ ...night, hrvAvgMs: 99999 }).success).toBe(false)
    expect(OuraDailySummaryPushSchema.safeParse({ ...night, breathAvgRpm: 500 }).success).toBe(false)
  })

  it('allows nulls and omissions — a COALESCE upsert relies on absent fields staying absent', () => {
    expect(OuraDailySummaryPushSchema.safeParse({ hrvAvgMs: null }).success).toBe(true)
    expect(OuraDailySummaryPushSchema.safeParse({}).success).toBe(true)
  })

  it('passes through keys it does not bound rather than stripping them', () => {
    // The branch reads the raw payload; a strict schema would silently drop fields.
    const r = OuraDailySummaryPushSchema.safeParse({ ...night, someFutureField: 1 })
    expect(r.success).toBe(true)
  })
})

describe('OuraDailyDerivedPushSchema', () => {
  const derived = { sleepScore: 78, readinessScore: 71, activityScore: 64, illnessScore: 12, wornHoursBle: 21.5 }

  it('accepts an ordinary day', () => {
    expect(OuraDailyDerivedPushSchema.safeParse(derived).success).toBe(true)
  })

  it('rejects a score outside its own 0-100 scale', () => {
    expect(OuraDailyDerivedPushSchema.safeParse({ ...derived, readinessScore: 5000 }).success).toBe(false)
    expect(OuraDailyDerivedPushSchema.safeParse({ ...derived, sleepScore: -1 }).success).toBe(false)
  })

  it('rejects more minutes than a day contains', () => {
    expect(OuraDailyDerivedPushSchema.safeParse({ ...derived, stressHighMinutes: 100000 }).success).toBe(false)
    expect(OuraDailyDerivedPushSchema.safeParse({ ...derived, wornHoursBle: 99 }).success).toBe(false)
  })

  it('leaves the open-ended research metrics alone rather than inventing a ceiling', () => {
    // vascularAge/pwv/resilience* have no settled range in the codebase; rejecting a
    // legitimate value is worse than accepting an odd one for an analysis output.
    const r = OuraDailyDerivedPushSchema.safeParse({ ...derived, vascularAge: 900, pwv: 1e6, resilienceLevel: -5 })
    expect(r.success).toBe(true)
  })

  it('allows nulls and omissions — the upsert COALESCEs absent fields', () => {
    expect(OuraDailyDerivedPushSchema.safeParse({}).success).toBe(true)
    expect(OuraDailyDerivedPushSchema.safeParse({ sleepScore: null }).success).toBe(true)
  })
})
