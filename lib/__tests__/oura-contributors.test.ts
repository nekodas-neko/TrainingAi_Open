import { describe, it, expect } from 'vitest'
import { formatContributors, weakestContributor, labelFor } from '@/lib/oura/contributors'

describe('formatContributors', () => {
  it('labels known keys and sorts worst-first', () => {
    expect(formatContributors({ hrv_balance: 90, deep_sleep: 60 }))
      .toBe('Deep sleep 60/100, HRV balance 90/100')
  })
  it('skips nulls and falls back to humanised unknown keys', () => {
    expect(formatContributors({ some_new_key: 70, timing: null }))
      .toBe('some new key 70/100')
  })
  it('handles null/empty input', () => {
    expect(formatContributors(null)).toBe('no contributor data')
    expect(formatContributors({})).toBe('no contributor data')
  })

  it('labels the Activity Score v2 own-component keys', () => {
    expect(formatContributors({ steps: 100, activeEnergy: 50 }))
      .toBe('Active energy 50/100, Steps 100/100')
  })
})

// The derived row's shape, which is what the readiness insight actually reads. It was rendering
// as `[object Object]/100` in production until 2026-09-26 (RV-201) because the only caller cast
// these rows to `Record<string, number | null>`, so nothing typed or tested the real payload.
describe('the derived contributor shape, which stores an object per key', () => {
  const derived = {
    checkin: { gap: null, input: 72, score: 72, provisional: false },
    hrvBalance: { gap: null, input: -0.75, score: 25, provisional: false },
    restingHeartRate: { gap: null, input: 0.61, score: 30, provisional: false },
  }

  it('reads .score instead of stringifying the object', () => {
    const out = formatContributors(derived)
    expect(out).not.toContain('[object Object]')
    expect(out).toContain('25/100')
    expect(out).toContain('72/100')
  })

  it('still sorts worst-first across the object shape', () => {
    expect(formatContributors(derived).startsWith('HRV balance 25/100')).toBe(true)
  })

  it('names the weakest by its score, not by key order', () => {
    expect(weakestContributor(derived)).toEqual({ label: 'HRV balance', value: 25 })
  })

  it('skips an entry whose score is missing rather than scoring it zero', () => {
    expect(formatContributors({ a: { score: 40 }, b: { input: 3 }, c: { score: null } }))
      .toBe('a 40/100')
  })

  it('reads a plain-number row unchanged — both shapes are live', () => {
    expect(weakestContributor({ hrv_balance: 90, recovery_index: 11 }))
      .toEqual({ label: 'Recovery index', value: 11 })
  })
})

// Every key the app's own readiness composite writes must have a label. Three of the nine had
// none until RV-201 and rendered as raw identifiers in the insight the owner reads.
describe('every READINESS_WEIGHTS key resolves to a human label', () => {
  const KEYS = [
    'restingHeartRate', 'previousNight', 'hrvBalance', 'temperature',
    'sleepBalance', 'prevDayActivity', 'recoveryIndex', 'activityBalance', 'checkin',
  ]
  it.each(KEYS)('%s', key => {
    const label = labelFor(key)
    expect(label, `${key} renders as its own identifier`).not.toBe(key)
    expect(label[0]).toBe(label[0].toUpperCase())
  })
})
