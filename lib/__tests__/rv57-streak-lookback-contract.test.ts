import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { STREAK_LOOKBACK_DAYS } from '@trainingai/shared/workout/streak-window'
import { stripComments } from '../../scripts/lib/strip-comments.js'

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
//
// **2026-09-27 (LA-156): THE LOOP IS GONE, AND SO IS THE FAILURE IT COULD HAVE — so the two
// assertions that named it are replaced rather than deleted.** The consumer now delegates to
// `computeDayStreak`, which walks the DATES IT WAS GIVEN instead of counting back day by day. There
// is no lookup past the window, so a supplier narrower than the consumer can no longer manufacture
// rest days out of missing keys — BF-176's oscillation is structurally impossible rather than
// merely guarded. Under-reporting against a short window remains, which is what the supplier
// assertion below is for, and it is the half that still has teeth.
const CONSUMER = 'app/session-select/compute-streak.ts'
const SUPPLIER = 'app/api/streak-data/route.ts'
const supplierSource = stripComments(readFileSync(path.join(ROOT, SUPPLIER), 'utf8'))

/** Comments quote the retired literal while explaining the fix, so a raw match would pass on prose. */
const source = stripComments(readFileSync(path.join(ROOT, CONSUMER), 'utf8'))

describe('RV-57 — the streak consumer is bound by the constant it is contracted to', () => {
  it('the SUPPLIER is still bound by the constant — the half that can still drift', () => {
    // The route decides how many days Home is sent. Narrow it by hand and Home quietly disagrees
    // with /api/achievements, which reads the history directly.
    expect(supplierSource).toMatch(/import\s*\{[^}]*\bSTREAK_LOOKBACK_DAYS\b[^}]*\}\s*from\s*["']@trainingai\/shared\/workout\/streak-window["']/)
  })

  it('the consumer does not walk a window of its own, so it cannot disagree about one', () => {
    // Delegation is the fix: a formula given the dates has nothing to assume about their span.
    expect(source).toMatch(/\bcomputeDayStreak\b/)
    expect(source).not.toMatch(/for\s*\(\s*let\s+ago\b/)
  })

  it('and no bare day-count literal has crept back in as a bound', () => {
    // The literal is the thing that could not be held to the contract, in any shape.
    expect(source).not.toMatch(/ago\s*<\s*365/)
    expect(source).not.toMatch(/\b365\b/)
  })

  // NOTE: this case guards the other direction and passes whatever the consumer looks like. The
  // supplier case above is the one with teeth — control-run 2026-09-27 by deleting the route's
  // import, which turns it red.
  it('and the constant still covers the horizon the loop was written for', () => {
    // A guard against "fixing" the drift by shrinking the constant instead: BF-176's failure was a
    // supplier narrower than the consumer, and 365 is the horizon this loop has always assumed.
    expect(STREAK_LOOKBACK_DAYS).toBeGreaterThanOrEqual(365)
  })
})
