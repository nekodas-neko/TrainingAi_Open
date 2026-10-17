import { describe, it, expect } from 'vitest'
import { capitalize } from '@trainingai/shared/format/capitalize'

describe('capitalize', () => {
  it('raises the first letter only, leaving later words alone', () => {
    expect(capitalize('upper back')).toBe('Upper back')
  })

  it('leaves an empty string and an already-capitalised word as they are', () => {
    expect(capitalize('')).toBe('')
    expect(capitalize('Quads')).toBe('Quads')
  })
})
