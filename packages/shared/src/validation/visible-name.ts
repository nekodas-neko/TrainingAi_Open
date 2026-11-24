// "This name has something a person can see" (#4129). The ONE test: the schemas that accept an
// exercise or lift name refuse a name for which it is false, and the AI prompt (`promptLineName`)
// prints "Unnamed exercise" for the same names, so what is refused and what is shown as unnamed
// can never drift apart.
//
// A name can be non-empty and still draw nothing: a zero-width space, a Hangul or Braille filler, a
// format character, a variation selector, whitespace. `promptSafeLine` only turns control characters
// and whitespace into spaces, so those pass `.min(1)` and a plan row then shows an empty name.
// Real names are untouched: a Persian name keeps its letters when the joiners are stripped, and an
// emoji, a Hangul or CJK syllable, an RTL word or a 120-character name each keep a visible character.
import { z } from 'zod'

/** Everything that can fill a name without drawing anything: format and control characters, any
 *  whitespace, and the fillers and selectors that are neither (Braille blank, combining grapheme
 *  joiner, Arabic letter mark, Hangul fillers, Mongolian vowel separator, variation selectors). */
const INVISIBLE_IN_A_NAME = /[\p{Cf}\p{Cc}\s⠀͏؜ᅟᅠㅤﾠ᠎︀-️\u{E0100}-\u{E01EF}]/gu

export function hasVisibleCharacter(name: string): boolean {
  return name.replace(INVISIBLE_IN_A_NAME, '') !== ''
}

/** The plain 400 message for an exercise or lift name with nothing visible in it. */
export const BLANK_EXERCISE_NAME_MESSAGE = 'Give the exercise a name'

/** Adds the visible-character rule to a name's string schema; every exercise-name schema calls this. */
export function visibleExerciseName<T extends z.ZodString>(schema: T, message = BLANK_EXERCISE_NAME_MESSAGE) {
  return schema.refine(hasVisibleCharacter, { message })
}
