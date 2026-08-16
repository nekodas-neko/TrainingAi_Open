// parseVoice was untested while it lived inside set-card.tsx. It is now the shared step between
// the native transcript and the web one — both sources feed it — so a wrong result here is a
// wrong logged set on either runtime.
import { describe, it, expect } from 'vitest'
import { parseVoice } from '@/components/workout/utils'

describe('parseVoice', () => {
  it('reads weight-then-reps with a spoken unit', () => {
    expect(parseVoice('80 kilos 5 reps')).toEqual({ weight: 80, reps: 5 })
    expect(parseVoice('eighty is not a number 80kg 5')).toMatchObject({ weight: 80, reps: 5 })
  })

  it('reads reps-then-weight', () => {
    expect(parseVoice('5 reps 80')).toEqual({ reps: 5, weight: 80 })
  })

  it('reads the by/times form', () => {
    expect(parseVoice('80 x 5')).toEqual({ weight: 80, reps: 5 })
    expect(parseVoice('82.5 × 3')).toEqual({ weight: 82.5, reps: 3 })
  })

  it('reads a single value on its own', () => {
    expect(parseVoice('5 reps')).toEqual({ reps: 5 })
    expect(parseVoice('80 kg')).toEqual({ weight: 80 })
  })

  it('keeps fractional plates', () => {
    expect(parseVoice('62.5 kilograms 8 repetitions')).toEqual({ weight: 62.5, reps: 8 })
  })

  it('returns nothing rather than guessing when there are no numbers', () => {
    // The caller shows "Heard …" on an empty parse — silently logging a guess would be worse.
    expect(parseVoice('start the next set')).toEqual({})
    expect(parseVoice('')).toEqual({})
  })
})
