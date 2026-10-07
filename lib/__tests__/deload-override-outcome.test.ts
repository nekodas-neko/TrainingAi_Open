import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import {
  deloadOverrideOutcome, deloadRevertNames, deloadOverrideBlocked, overrideRunsFull, prescriptionRowAsTrained,
} from '@/components/workout/utils'
import { stripComments } from '../../scripts/lib/strip-comments.js'

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

const prescribed = (phaseAction: string, prescriptionStatus: string) => ({
  prescription: { phaseAction, deload: true, phase: 'deload', exercises: [] } as never,
  prescriptionStatus: prescriptionStatus as never,
})
/** The LB-47 cases below are all prescriptions that reach the bar — a stored deload in force. */
const DRIVES = { periodization: prescribed('stay', 'auto_applied'), deloadWeek: false }

describe('the shape the only real session deload takes', () => {
  // Production 2026-09-02: prescription 429b91a9, `deload: true`, 5 exercises, 0 with `deloaded`,
  // 0 with `preDeload`. The low intensities are in the LLM's own pct values.
  const sessionDeload = [ex('Squat', false, false), ex('Bench', false, false), ex('Row', false, false)]

  it('reverts nothing and blocks nothing — which is why the two could not tell it apart', () => {
    expect(deloadRevertNames(sessionDeload, [], true)).toEqual([])
    expect(deloadOverrideBlocked(sessionDeload, true)).toEqual([])
  })

  it('is now distinguishable from a clean full revert', () => {
    expect(deloadOverrideOutcome(sessionDeload, true, DRIVES)).toBe('nothing-to-revert')
    expect(deloadOverrideOutcome([ex('Squat', true, true)], true, DRIVES)).toBe('all')
  })

  it('a deload with no pre-deload numbers anywhere is the same honest answer', () => {
    // Not the session-level shape, but the same thing is true of it: there is nothing to go back to.
    expect(deloadOverrideOutcome([ex('Squat', true, false), ex('Bench', true, false)], true, DRIVES))
      .toBe('nothing-to-revert')
  })
})

describe('the cases that already worked must not move', () => {
  it('a mixed prescription is partial, not one of the two absolutes', () => {
    expect(deloadOverrideOutcome([ex('Squat', true, true), ex('Bench', true, false)], true, DRIVES)).toBe('partial')
  })

  it('no override means no claim at all', () => {
    expect(deloadOverrideOutcome([ex('Squat', true, true)], false, DRIVES)).toBe('none')
    expect(deloadOverrideOutcome([], false, DRIVES)).toBe('none')
  })

  it('an undeloaded exercise beside a revertible one does not make it partial', () => {
    // `partial` has to mean "some deloaded exercises could not revert", never "some exercises were
    // not deloaded" — otherwise every ordinary prescription with one deloaded lift reads as partial
    // and the card starts naming exercises that were never deloaded.
    expect(deloadOverrideOutcome([ex('Squat', true, true), ex('Bench', false, false)], true, DRIVES)).toBe('all')
  })
})

/**
 * #2360 — after Full overrode a whole-session deload, the card still said it was a deload.
 *
 * Release test of v1.488.0, reproduced on the local dev server: an emergency deload pending from a
 * sick check-in, Full chosen. The bar ran 3×8 @ 75% with sets counting toward 1RM, and the card said
 * *"Full is on, but these weights are unchanged"* and *"these sets are logged as a deload"*, over a
 * list still reading 2×6 @ 50% with a Deload tag on every row.
 *
 * Two inputs were wrong. The outcome was read from the list AFTER the revert, where nothing is
 * deloaded once it has worked. And on the pending emergency deload itself, nothing is deloaded even
 * before it: choosing Full refetches without `aiDeload`, and a pending `deload_recommended` does not
 * drive the load, so the program's own numbers arrive undeloaded. An empty deloaded list only means
 * "nothing to revert" when the prescription is the thing on the bar.
 */
describe('#2360 — the outcome follows the session that will actually run', () => {
  const BF198 = [ex('Bench Press', true, true), ex('Overhead Press', true, true), ex('Tricep Pushdown', true, true)]
  const program = [ex('Bench Press', false, false), ex('Overhead Press', false, false), ex('Tricep Pushdown', false, false)]
  const pendingEmergency = { periodization: prescribed('deload_recommended', 'pending'), deloadWeek: false }

  it('a pending emergency deload under Full runs the program, so it is a full session', () => {
    // The release-test shape. Fails on main, which ignored the prescription and said nothing-to-revert.
    expect(deloadOverrideOutcome(program, true, pendingEmergency)).toBe('all')
  })

  it('a deload in force, read before the revert, is a full revert', () => {
    expect(deloadOverrideOutcome(BF198, true, DRIVES)).toBe('all')
  })

  it('the same deload read AFTER the revert is the bug, which is why the input is pinned below', () => {
    const reverted = BF198.map(e => ({ ...e, deloaded: false }))
    expect(deloadOverrideOutcome(reverted, true, DRIVES)).toBe('nothing-to-revert')
  })

  it('still says nothing changed when nothing could — no recorded full numbers, deload in force', () => {
    expect(deloadOverrideOutcome([ex('Skull Crusher', true, false)], true, DRIVES)).toBe('nothing-to-revert')
    expect(deloadOverrideOutcome([ex('Skull Crusher', true, false)], true, pendingEmergency)).toBe('nothing-to-revert')
  })

  // #2404. This used to read "a deload week is never called full" and answered `nothing-to-revert`,
  // so the card said "Full is on, but these weights are unchanged". The weights DO change: Full
  // reverts every deloaded exercise that recorded full numbers (`deloadRevertNames`), and the bar
  // loads them. What does not change is the logging, which stays a deload because
  // `isAnyDeload = deload || phaseStatus.isDeloadActive`. Both halves are said, not one.
  it('a deload week under Full loads the full numbers and says every set is still logged as a deload', () => {
    expect(deloadOverrideOutcome(BF198, true, { ...DRIVES, deloadWeek: true })).toBe('all-in-deload-week')
  })

  it('a deload week where some exercises cannot revert is partial, and still logged as a deload', () => {
    expect(deloadOverrideOutcome([ex('Squat', true, true), ex('Bench', true, false)], true, { ...DRIVES, deloadWeek: true }))
      .toBe('partial-in-deload-week')
  })

  it('a deload week with nothing recorded to revert still says the weights are unchanged', () => {
    expect(deloadOverrideOutcome([ex('Skull Crusher', true, false)], true, { ...DRIVES, deloadWeek: true })).toBe('nothing-to-revert')
  })

  it('a deload week with no deloaded exercise makes no claim of a revert', () => {
    // Nothing was cut, so nothing was put back. Not upgraded to a "full in deload week".
    expect(deloadOverrideOutcome(program, true, { ...pendingEmergency, deloadWeek: true })).toBe('nothing-to-revert')
  })

  it('every outcome that put the session back on full numbers runs full, in a deload week or not', () => {
    for (const outcome of ['all', 'partial', 'all-in-deload-week', 'partial-in-deload-week'] as const) {
      expect(overrideRunsFull(outcome), outcome).toBe(true)
    }
    for (const outcome of ['none', 'nothing-to-revert'] as const) {
      expect(overrideRunsFull(outcome), outcome).toBe(false)
    }
  })

  it('no prescription at all cannot be on the bar', () => {
    expect(deloadOverrideOutcome(program, true, { periodization: null, deloadWeek: false })).toBe('all')
  })
})

describe('#2360 — the card rows show the numbers the bar will load', () => {
  const row = {
    sessionExerciseId: 'se-1', name: 'Bench Press', sets: 2, reps: 6, pct: 50, restSec: 120,
    deloaded: true, deloadNote: 'Deload', preDeload: { sets: 3, reps: 8, pct: 75, restSec: 90 },
  }

  it('a reverted row reads at its recorded full numbers, with no Deload flag', () => {
    expect(prescriptionRowAsTrained(row, true)).toMatchObject({ sets: 3, reps: 8, pct: 75, restSec: 90, deloaded: false })
  })

  it('a row with no recorded full numbers stays the deload it still is', () => {
    const noRecord = { ...row, preDeload: undefined }
    expect(prescriptionRowAsTrained(noRecord, true)).toBe(noRecord)
  })

  it('without a working override the row is the prescription, untouched', () => {
    expect(prescriptionRowAsTrained(row, false)).toBe(row)
  })

  it('only all/partial count as running full', () => {
    expect(overrideRunsFull('all')).toBe(true)
    expect(overrideRunsFull('partial')).toBe(true)
    expect(overrideRunsFull('nothing-to-revert')).toBe(false)
    expect(overrideRunsFull('none')).toBe(false)
  })
})

const ROOT = path.resolve(__dirname, '../..')
const source = (rel: string) => stripComments(readFileSync(path.join(ROOT, rel), 'utf8'))

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
    /\{overrideOutcome === 'nothing-to-revert'\s*\?\s*"This prescription has no full numbers recorded[^"]*"\s*:\s*overrideBlockedNames\.length === 0\s*\?\s*"Every exercise is back to its pre-deload weights/

  it('guards the honest sentence on the outcome, and reaches it before the blocked check', () => {
    // One pattern, so it cannot be satisfied by the condition and the sentence existing separately:
    // it requires this condition, immediately followed by this consequent, immediately followed by
    // the blocked branch as the fallthrough. `{false ? …`, a reordering, and a deleted branch all
    // break it.
    expect(card()).toMatch(HONEST_BRANCH)
  })

  it('makes no revert or 1RM claim in that branch', () => {
    const sentence = card().match(/"This prescription has no full numbers recorded[^"]*"/)![0]
    expect(sentence).toContain('stay as they are')
    // #2131: it used to send him to "a new prescription", which nothing on screen can request. The
    // remedy it names must be one that exists.
    expect(sentence).not.toMatch(/new prescription for that/)
    expect(sentence).toContain('program editor')
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
    //
    // #2360: this used to pin `deloadOverrideOutcome(exercises, overrideFull)` inside
    // pre-workout-screen, where `exercises` is the list AFTER the revert — the test was guarding the
    // bug. The derivation now lives beside the revert, on the list it reverts.
    const screen = source('components/workout-screen.tsx')
    expect(screen).toMatch(/deloadOverrideOutcome\(exercises, overrideFull, \{/)
    expect(screen).not.toMatch(/deloadOverrideOutcome\(effectiveExercises/)
    expect(screen).toMatch(/overrideOutcome=\{overrideOutcome\}/)
    expect(source('components/workout/pre-workout-screen.tsx')).toMatch(/overrideOutcome=\{overrideOutcome\}/)
  })

  it('#2360: a working override changes the header and the rows, and nothing else does', () => {
    const c = card()
    expect(c).toMatch(/const runsFull = overrideFull && overrideRunsFull\(overrideOutcome\)/)
    expect(c).toMatch(/AI Prescription · \{runsFull \? "Full" : \(phaseLabel/)
    expect(c).toMatch(/const ex = prescriptionRowAsTrained\(prescribed, runsFull\)/)
  })

  it('#2360: a reverted exercise gets no chip under the session override; a blocked one keeps its', () => {
    expect(source('components/workout/pre-workout-screen.tsx'))
      .toMatch(/\(ex\.deloaded \|\| \(ex\.deloadReverted && !overrideFull\)\) && \(/)
  })

  it('the heading changes too, guarded on the same outcome', () => {
    // "Running full, overriding the deload" above a paragraph saying nothing changed is the same
    // contradiction one line up. Condition and consequent together here as well.
    expect(card()).toMatch(
      /\{overrideOutcome === 'nothing-to-revert'\s*\?\s*"Full is on, but these weights are unchanged"/,
    )
  })
})
