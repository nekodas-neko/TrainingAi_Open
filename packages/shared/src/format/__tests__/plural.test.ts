import { describe, it, expect } from 'vitest'
import { plural } from '@trainingai/shared/format/plural'

describe('plural', () => {
  it('uses the singular for exactly one', () => {
    expect(plural(1, 'set', 'sets')).toBe('1 set')
  })

  it('uses the plural for zero and for more than one', () => {
    expect(plural(0, 'set', 'sets')).toBe('0 sets')
    expect(plural(2, 'entry', 'entries')).toBe('2 entries')
  })

  it('treats a fraction as plural, so 1.5 never reads as one', () => {
    expect(plural(1.5, 'dose', 'doses')).toBe('1.5 doses')
  })
})
