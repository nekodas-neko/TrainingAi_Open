import { describe, expect, it } from 'vitest'
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { retitle } = require('../sync-title-prefixes.js')

describe('retitle', () => {
  it('puts the type label in front of the title', () => {
    expect(retitle('Fix the nap split', ['type: bug', 'area: sleep'])).toBe('bug: Fix the nap split')
  })
  it('replaces a stale prefix when the type label changes', () => {
    expect(retitle('bug: Fix the nap split', ['type: feature'])).toBe('feature: Fix the nap split')
  })
  it('leaves a title that is already right alone', () => {
    expect(retitle('device-check: Owed checks', ['type: device-check'])).toBeNull()
  })
  it('does nothing without exactly one type label', () => {
    expect(retitle('Something', ['area: sleep'])).toBeNull()
    expect(retitle('Something', ['type: bug', 'type: chore'])).toBeNull()
  })
  it('does not mistake a colon inside the title for a prefix', () => {
    expect(retitle('ACWR: an 8-day window', ['type: question'])).toBe('question: ACWR: an 8-day window')
  })
})
