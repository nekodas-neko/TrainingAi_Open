import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { STREAK_LOOKBACK_DAYS } from '@trainingai/shared/workout/streak-window'

/**
 * RV-57. `STREAK_LOOKBACK_DAYS` calls itself a contract between two files, and only one of them
 * read it.
 *
 * Its module header (`packages/shared/src/workout/streak-window.ts`) is explicit: *"This number is
 * a CONTRACT between two files that used to disagree silently … Any new streak surface reads this
 * constant."* The supplier obeys — `app/api/streak-data/route.ts` imports it. The consumer walked
 * `for (let ago = 1; ago < 365; ago++)` with no import at all.
 *
 * **There was no live bug, and that is exactly why this needs a test rather than a fix alone.** 365
 * and `< 365` cover the same span, so nothing was visibly wrong and nothing behavioural can fail.
 * What was broken is the *enforcement*: changing the constant would have reintroduced BF-176 —
 * the route sending 90 while the loop walked 365, so every lookup past the window read as a rest
 * day and the streak became a property of the window edge, oscillating 88↔90 while the owner kept
 * training. A literal cannot be held to a contract; this asserts the consumer is bound by it.
 *
 * Source-level on purpose: the defect IS the absence of an import, which no runtime assertion can
 * observe while both numbers agree.
 */
const ROOT = path.resolve(__dirname, '../..')
// The loop moved out of `session-select-content.tsx` on 2026-09-22 (RV-86 needed eleven lines in a
// file at its size baseline, so the walk was extracted rather than the comments shaved). That move
// turned this file red, which is the behaviour to keep: a path named here is how the test notices
// the consumer has gone somewhere it is no longer watching.
const CONSUMER = 'app/session-select/compute-streak.ts'

/** Comments quote the retired literal while explaining the fix, so a raw match would pass on prose. */
const source = readFileSync(path.join(ROOT, CONSUMER), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
  .replace(/^\s*\/\/.*$/gm, '')

describe('RV-57 — the streak consumer is bound by the constant it is contracted to', () => {
  it('imports the shared constant', () => {
    expect(source).toMatch(/import\s*\{[^}]*\bSTREAK_LOOKBACK_DAYS\b[^}]*\}\s*from\s*["']@trainingai\/shared\/workout\/streak-window["']/)
  })

  it('walks the loop to that constant, not to a literal', () => {
    expect(source).toMatch(/for\s*\(\s*let\s+ago\s*=\s*1;\s*ago\s*<\s*STREAK_LOOKBACK_DAYS;/)
    // The literal is the thing that could not be held to the contract. Any bare 365 as a loop bound
    // here is the defect returning, whatever the surrounding code looks like.
    expect(source).not.toMatch(/ago\s*<\s*365/)
  })

  // NOTE: this case passes against the UNFIXED file too — it guards the other direction and is not
  // evidence of this fix. The two above are: both were run against `origin/main` and both went red.
  it('and the constant still covers the horizon the loop was written for', () => {
    // A guard against "fixing" the drift by shrinking the constant instead: BF-176's failure was a
    // supplier narrower than the consumer, and 365 is the horizon this loop has always assumed.
    expect(STREAK_LOOKBACK_DAYS).toBeGreaterThanOrEqual(365)
  })
})
