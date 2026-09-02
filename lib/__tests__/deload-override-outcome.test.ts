import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { deloadOverrideOutcome, deloadRevertNames, deloadOverrideBlocked } from '@/components/workout/utils'

/**
 * LB-47 — a session-level `Full` override told the user it had worked when it had not.
 *
 * **The entry's premise needed correcting, and the correction is what these tests pin.** It said the
 * override "reverts nothing" on a real session-level deload, and measured 5 stored prescriptions: 1
 * session-level deload with 0 exercises carrying `preDeload`, 2 with a per-exercise deload, 0 with
 * both. That measurement is exactly right — re-confirmed against production 2026-09-02.
 *
 * What it missed is that "reverts nothing" was not the visible failure. `deloadOverrideBlocked`
 * returns empty in that case too, and the card read `blocked.length === 0` as *everything reverted*
 * — so it rendered **"Every exercise is back to its pre-deload weights and sets, and these sets
 * count toward your 1RM."** Both clauses false, in the direction that misleads: BF-8's complaint
 * (*"I was under the assumption I was doing my full session"*) arriving from the other side.
 */

const ex = (name: string, deloaded: boolean, hasPre: boolean) => ({
  name,
  deloaded,
  preDeloadStyle: hasPre ? ({ id: 'p' } as never) : undefined,
})

describe('the shape the only real session deload takes', () => {
  // Production 2026-09-02: prescription 429b91a9, `deload: true`, 5 exercises, 0 with `deloaded`,
  // 0 with `preDeload`. The low intensities are in the LLM's own pct values.
  const sessionDeload = [ex('Squat', false, false), ex('Bench', false, false), ex('Row', false, false)]

  it('reverts nothing and blocks nothing — which is why the two could not tell it apart', () => {
    expect(deloadRevertNames(sessionDeload, [], true)).toEqual([])
    expect(deloadOverrideBlocked(sessionDeload, true)).toEqual([])
  })

  it('is now distinguishable from a clean full revert', () => {
    expect(deloadOverrideOutcome(sessionDeload, true)).toBe('nothing-to-revert')
    expect(deloadOverrideOutcome([ex('Squat', true, true)], true)).toBe('all')
  })

  it('a deload with no pre-deload numbers anywhere is the same honest answer', () => {
    // Not the session-level shape, but the same thing is true of it: there is nothing to go back to.
    expect(deloadOverrideOutcome([ex('Squat', true, false), ex('Bench', true, false)], true))
      .toBe('nothing-to-revert')
  })
})

describe('the cases that already worked must not move', () => {
  it('a mixed prescription is partial, not one of the two absolutes', () => {
    expect(deloadOverrideOutcome([ex('Squat', true, true), ex('Bench', true, false)], true)).toBe('partial')
  })

  it('no override means no claim at all', () => {
    expect(deloadOverrideOutcome([ex('Squat', true, true)], false)).toBe('none')
    expect(deloadOverrideOutcome([], false)).toBe('none')
  })

  it('an undeloaded exercise beside a revertible one does not make it partial', () => {
    // `partial` has to mean "some deloaded exercises could not revert", never "some exercises were
    // not deloaded" — otherwise every ordinary prescription with one deloaded lift reads as partial
    // and the card starts naming exercises that were never deloaded.
    expect(deloadOverrideOutcome([ex('Squat', true, true), ex('Bench', false, false)], true)).toBe('all')
  })
})

const ROOT = path.resolve(__dirname, '../..')
const source = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')

describe('the card says the honest thing', () => {
  const card = () => source('components/workout/ai-prescription-card.tsx')

  /**
   * **Every assertion here pins the CONDITION and its consequent together, in one pattern.**
   *
   * The first version tested them apart — `indexOf` for the condition, `toContain` for the sentence
   * — and it **passed against `{false ? "This prescription lowered …"`**. Two reasons at once: the
   * text of an unreachable branch is still in the file, and `overrideOutcome === 'nothing-to-revert'`
   * also appears in the heading ternary directly above, so the condition was still found even after
   * the body's was deleted. That is the sixth time this session that a guard matching text which
   * survives the feature being disabled read as coverage and was not.
   */
  const HONEST_BRANCH =
    /\{overrideOutcome === 'nothing-to-revert'\s*\?\s*"This prescription lowered the whole session[^"]*"\s*:\s*overrideBlockedNames\.length === 0\s*\?\s*"Every exercise is back to its pre-deload weights/

  it('guards the honest sentence on the outcome, and reaches it before the blocked check', () => {
    // One pattern, so it cannot be satisfied by the condition and the sentence existing separately:
    // it requires this condition, immediately followed by this consequent, immediately followed by
    // the blocked branch as the fallthrough. `{false ? …`, a reordering, and a deleted branch all
    // break it.
    expect(card()).toMatch(HONEST_BRANCH)
  })

  it('makes no revert or 1RM claim in that branch', () => {
    const sentence = card().match(/"This prescription lowered the whole session[^"]*"/)![0]
    expect(sentence).toContain('does not change')
    // The specific false sentence, not the phrase "back to" — the honest copy legitimately says
    // there is nothing to *go back to*, and a blunter matcher fails on the fix itself.
    expect(sentence, 'the false claim must not be what this branch renders')
      .not.toMatch(/back to (its|their) pre-deload/)
    expect(sentence, 'no 1RM claim — the override did not happen, so nothing is owed either way')
      .not.toMatch(/1RM/)
  })

  it('the card is actually GIVEN the outcome, derived from the real inputs', () => {
    // The card defaults `overrideOutcome` to 'none', so dropping the prop leaves every assertion
    // above passing while the honest branch can never render -- the same "text present, feature
    // off" shape as the {false ? ...} mutation, one file up. Pinned to the derivation, not just to
    // the prop name: `overrideOutcome={'none'}` would satisfy a looser matcher.
    expect(source('components/workout/pre-workout-screen.tsx'))
      .toMatch(/overrideOutcome=\{deloadOverrideOutcome\(exercises, overrideFull\)\}/)
  })

  it('the heading changes too, guarded on the same outcome', () => {
    // "Running full, overriding the deload" above a paragraph saying nothing changed is the same
    // contradiction one line up. Condition and consequent together here as well.
    expect(card()).toMatch(
      /\{overrideOutcome === 'nothing-to-revert'\s*\?\s*"Full is on, but these weights are unchanged"/,
    )
  })
})
