import { describe, it, expect } from 'vitest'
import { hasVisibleCharacter, BLANK_EXERCISE_NAME_MESSAGE } from '@trainingai/shared/validation/visible-name'
import { WorkoutTemplateWriteRequestSchema as WorkoutTemplateWriteSchema } from '@trainingai/shared/validation/program-write-request'
import { promptLineName, UNNAMED_PROMPT_LINE_NAME } from '@trainingai/shared/ai-periodization/prompt'
import { LogExercisePayloadSchema } from '@trainingai/shared/workout/log-payload'

/** #4129: made-up names only. */
const INVISIBLE = [
  '​', 'ㅤ', '⠀', ' ', '\t', ' ', '​‍﻿', 'ᅟᅠ', '͏', '؜',
  'ﾠ', '᠎', '️', '\u{E0100}', '‮', '\u0007', ' ㅤ ⠀ ', ' ',
]
const REAL = [
  'Bench Press',
  'می‌رود ‌پرس',          // Persian with a zero-width non-joiner
  'پرس سینه',                       // RTL
  'Push Up 💪', '💪',               // emoji, alone and inside a name
  '벤치 프레스', '卧推', 'ベンチプレス', // Hangul, CJK, kana
  'a'.repeat(120),
  'x​',                        // a real letter beside an invisible one
  'ក្ខ\u17B4ក',                       // Khmer: an inherent vowel between visible letters
  'ᠮᠣ\u180Bᠩ', 'ᠬ\u180Dᠠ',          // Mongolian: a free variation selector between letters
  'é', 'e\u0301', 'ا\u064Eب',       // combining accents
  '👩‍🏋️', '🏋🏽‍♂️',                    // emoji ZWJ sequences
]

describe('hasVisibleCharacter (#4129)', () => {
  it.each(INVISIBLE)('a name of only invisible characters %j has none', n => {
    expect(hasVisibleCharacter(n)).toBe(false)
  })
  it('an empty name has none', () => expect(hasVisibleCharacter('')).toBe(false))
  it.each(REAL)('real name %j has one', n => expect(hasVisibleCharacter(n)).toBe(true))
  it('is the same test the AI prompt uses to print "Unnamed exercise"', () => {
    for (const n of [...INVISIBLE, ...REAL]) {
      expect(promptLineName(n) === UNNAMED_PROMPT_LINE_NAME, JSON.stringify(n)).toBe(!hasVisibleCharacter(n))
    }
  })
})

const program = (exerciseName: string, extra: object = {}) => ({
  program: { name: 'Push', sessions: [{ id: 's1', name: 'Day', exercises: [{ id: 'e1', exerciseName, ...extra }] }] },
})

describe('the program write schema refuses a lift with nothing visible in its name (#4129)', () => {
  it.each(INVISIBLE.filter(n => n !== ''))('refuses %j', n => {
    const r = WorkoutTemplateWriteSchema.safeParse(program(n))
    expect(r.success).toBe(false)
    if (!r.success) expect(r.error.issues.some(i => i.message === BLANK_EXERCISE_NAME_MESSAGE)).toBe(true)
  })
  it.each(REAL)('accepts %j', n => expect(WorkoutTemplateWriteSchema.safeParse(program(n)).success).toBe(true))

  // A lift that already carries such a name (stored before this rule) stays workable.
  it('a lift stored with a blank name can be renamed to a real name, or deleted from the program', () => {
    expect(WorkoutTemplateWriteSchema.safeParse(program('​')).success).toBe(false) // as-is: refused, with the message
    expect(WorkoutTemplateWriteSchema.safeParse(program('Cable Row')).success).toBe(true) // renamed
    expect(WorkoutTemplateWriteSchema.safeParse({ program: { name: 'Push', sessions: [{ id: 's1', name: 'Day', exercises: [] }] } }).success).toBe(true) // deleted
  })
  it('a lift stored with a blank name can still be logged (the log payload does not ask for a visible name)', () => {
    const r = LogExercisePayloadSchema.safeParse({ sessionName: 'Day', exercise: '\u200B', weights: [40, 40], sets: 2, reps: [8, 8] })
    expect(r.success, JSON.stringify(!r.success && r.error.issues)).toBe(true)
  })
})

describe('the class is derived from Unicode properties (#4134 review)', () => {
  it('every default-ignorable code point and every Cf code point is invisible', () => {
    const di = /\p{Default_Ignorable_Code_Point}|\p{Cf}/u
    const missed: string[] = []
    for (let cp = 1; cp <= 0x10ffff; cp++) {
      if (cp >= 0xd800 && cp <= 0xdfff) continue
      const ch = String.fromCodePoint(cp)
      if (di.test(ch) && hasVisibleCharacter(ch)) missed.push(cp.toString(16))
    }
    expect(missed).toEqual([])
  })
})
