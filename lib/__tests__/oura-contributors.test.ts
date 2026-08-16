import { describe, it, expect } from 'vitest'
import { formatContributors } from '@/lib/oura/contributors'

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
