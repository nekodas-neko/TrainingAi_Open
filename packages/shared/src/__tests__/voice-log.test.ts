// parseVoice was untested while it lived inside set-card.tsx. It is now the shared step between
// the native transcript and the web one — both sources feed it — so a wrong result here is a
// wrong logged set on either runtime.
import { describe, it, expect } from 'vitest'
import { parseVoice, clampVoiceLogResult, VOICE_LOG_EXAMPLE } from '../workout/voice-log'

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

  // BF-66. The old parser stripped every character outside `[0-9.\s kgreps×x]`, so a filler word
  // whose letters all fell outside that set vanished and the two-numbers fallback fired, while one
  // that left a letter behind blocked it — `by` and `at` worked, `for` and `times` did not, and the
  // owner's `60 for 6` was shown back to them in red as if it had been misheard. Every row of the
  // measured table is here; each must reach 60 × 6.
  it.each([
    '60 for 6',
    '60 kg for 6',
    '60 times 6',
    '60 by 6',
    '60 at 6',
    '60 x 6',
    '60 kilos for 6 reps',
    '60kg6',
  ])('ignores the filler word in %j', (said) => {
    expect(parseVoice(said)).toMatchObject({ weight: 60, reps: 6 })
  })

  it('does not let a set count take the weight slot', () => {
    expect(parseVoice('3 sets of 60 for 6')).toMatchObject({ weight: 60, reps: 6 })
  })

  it('reads the keywords in either order', () => {
    expect(parseVoice('6 reps at 60 kg')).toMatchObject({ weight: 60, reps: 6 })
  })

  it('returns nothing rather than guessing when there are no numbers', () => {
    // The caller shows "Heard …" on an empty parse — silently logging a guess would be worse.
    expect(parseVoice('start the next set')).toEqual({})
    expect(parseVoice('')).toEqual({})
  })

  it('will not guess which slot a lone bare number belongs to', () => {
    // "60" is as plausibly six-and-a-bit reps as sixty kilos; the caller's message asks again.
    expect(parseVoice('60')).toEqual({})
  })
})

describe('parseVoice — phrasings the recogniser returns', () => {
  it('ignores case, since recognisers capitalise unpredictably', () => {
    expect(parseVoice('80 KG 5 Reps')).toEqual({ weight: 80, reps: 5 })
  })

  it('reads plural units', () => {
    expect(parseVoice('80 kgs for 5 reps')).toEqual({ weight: 80, reps: 5 })
    expect(parseVoice('5 repetitions at 82.5 kilograms')).toEqual({ weight: 82.5, reps: 5 })
  })

  it('leaves spelled-out numbers unread rather than guessing', () => {
    // The Android recogniser normally returns digits; if it does not, the caller says what to say.
    expect(parseVoice('eighty kilos for eight')).toEqual({})
  })

  it('accepts its own example phrase', () => {
    expect(parseVoice(VOICE_LOG_EXAMPLE)).toEqual({ weight: 60, reps: 6 })
  })
})

describe('clampVoiceLogResult', () => {
  it('passes through in-range values unchanged', () => {
    expect(clampVoiceLogResult(80, 8)).toEqual({ weight: 80, reps: 8 })
  })
  it('clamps a mis-heard 0 reps up to the 1-rep floor (matches the +/- control)', () => {
    expect(clampVoiceLogResult(80, 0)).toEqual({ weight: 80, reps: 1 })
  })
  it("clamps reps above the server schema's max (100)", () => {
    expect(clampVoiceLogResult(80, 250)).toEqual({ weight: 80, reps: 100 })
  })
  it('rounds a fractional rep count', () => {
    expect(clampVoiceLogResult(80, 8.6)).toEqual({ weight: 80, reps: 9 })
  })
  it('clamps a mis-heard negative weight up to 0', () => {
    expect(clampVoiceLogResult(-40, 8)).toEqual({ weight: 0, reps: 8 })
  })
  it("clamps weight above the server schema's max (500)", () => {
    expect(clampVoiceLogResult(9999, 8)).toEqual({ weight: 500, reps: 8 })
  })
  it('leaves an omitted field undefined', () => {
    expect(clampVoiceLogResult(undefined, 8)).toEqual({ weight: undefined, reps: 8 })
    expect(clampVoiceLogResult(80, undefined)).toEqual({ weight: 80, reps: undefined })
  })
})
