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

/** Everything that can fill a name without drawing anything, taken from Unicode's own properties
 *  rather than a hand-typed list: every default-ignorable code point (soft hyphen, zero-width and
 *  bidi controls, Khmer inherent vowels, Mongolian free variation selectors and vowel separator,
 *  combining grapheme joiner, Hangul fillers, variation selectors, tag characters, ...), every format
 *  character (`Cf`: also the Arabic number signs, Kaithi and Egyptian-hieroglyph format controls,
 *  musical-symbol formatting), control characters and any whitespace. Four fillers are none of those
 *  but still render as nothing: the Braille blank U+2800 and the Hangul fillers U+3164, U+115F,
 *  U+1160 and U+FFA0 (the last three are default-ignorable already; named for the reader).
 *
 *  Needs `\p{Default_Ignorable_Code_Point}` under the `u` flag: Node 22 (checked on v22.23) and the
 *  device's Chromium WebView both have it. */
const INVISIBLE_IN_A_NAME = /[\p{Default_Ignorable_Code_Point}\p{Cf}\p{Cc}\s\u2800\u3164\u115F\u1160\uFFA0]/gu

/** The same class as inclusive code-point ranges, for the one place a regex engine has no `\p{…}`:
 *  Postgres, in `scripts/tuning/blank-exercise-names-4129.sql`. Enumerated from the SAME regex, so
 *  the count script and the predicate cannot differ. NUL and lone surrogates are skipped (neither can
 *  be stored in a Postgres text column). */
export function invisibleNameRanges(): Array<[number, number]> {
  const ranges: Array<[number, number]> = []
  const probe = new RegExp(INVISIBLE_IN_A_NAME.source, 'u')
  for (let cp = 1; cp <= 0x10ffff; cp++) {
    if (cp >= 0xd800 && cp <= 0xdfff) continue
    if (!probe.test(String.fromCodePoint(cp))) continue
    const last = ranges[ranges.length - 1]
    if (last && last[1] === cp - 1) last[1] = cp
    else ranges.push([cp, cp])
  }
  return ranges
}

/** `invisibleNameRanges()` as the inside of a Postgres regex bracket expression (`\uXXXX` and
 *  `\UXXXXXXXX` escapes, which Postgres' regex engine reads). */
export function invisibleNameClassSql(): string {
  const esc = (cp: number) => (cp <= 0xffff ? `\\u${cp.toString(16).toUpperCase().padStart(4, '0')}` : `\\U${cp.toString(16).toUpperCase().padStart(8, '0')}`)
  return invisibleNameRanges().map(([a, b]) => (a === b ? esc(a) : `${esc(a)}-${esc(b)}`)).join('')
}

export function hasVisibleCharacter(name: string): boolean {
  return name.replace(INVISIBLE_IN_A_NAME, '') !== ''
}

/** The plain 400 message for an exercise or lift name with nothing visible in it. */
export const BLANK_EXERCISE_NAME_MESSAGE = 'Give the exercise a name'

/** Adds the visible-character rule to a name's string schema; every exercise-name schema calls this. */
export function visibleExerciseName<T extends z.ZodString>(schema: T, message = BLANK_EXERCISE_NAME_MESSAGE) {
  return schema.refine(hasVisibleCharacter, { message })
}
