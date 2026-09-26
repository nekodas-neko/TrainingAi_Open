// OR-100 — `next-item.js` prints Keeps under a heading that says *"shipped; only the stated residue
// is owed. **Not new work**"*. That is true of most of them and false of a few, and the few vanish
// from where implementers look: measured on Lane B's queue, four of twelve Keeps were builds,
// including a fully specified UI half whose engine had already shipped.
//
// Driven against fixtures rather than the live backlog on purpose — a test that reads the real file
// changes verdict as the repo does, which is the one thing a regression test for a classifier must
// not do (the same reasoning `entries-verdict.js` was extracted for).
import { describe, it, expect } from 'vitest'

const { keepKind, keepIsSettled } = require('../lib/keep-kind.js') as {
  keepKind: (t: string) => string
  keepIsSettled: (k: { text: string; gate: 'owner' | 'device' | null } | null, lines: string[]) => boolean
}

describe('keepKind — a residue that is a verification', () => {
  // The commonest shape by far, and it is correctly a Keep: nobody can write code for it.
  it('reads the device-check phrasings', () => {
    for (const t of [
      'the device check, and only that. On the S25 with gesture navigation.',
      'the on-device check, against `/admin/oura-ble` in the APK with real ring data.',
      'the device press. Everything here is verified against the state machine.',
      'the device pass. The action row\'s safe-area inset renders 0 in the sandbox.',
      'the S25 check, and only that.',
      'the press itself, on the S25 — whether the row competes with PullToSync.',
      'the gesture itself, on the S25.',
    ]) expect(keepKind(t), t).toBe('check')
  })

  it('reads the owner-decision phrasings', () => {
    for (const t of [
      "the history recompute is the owner's call, and the entry's version would make it worse.",
      'RESOLVED except one owner decision: whether to DROP the retired column.',
      'what is owed is the owner seeing a quiet morning.',
    ]) expect(keepKind(t), t).toBe('check')
  })

  it('reads "not reproduced" as a check, because reproducing it is the owed work', () => {
    expect(keepKind('not reproduced at runtime. The chain is read from source.')).toBe('check')
  })
})

describe('keepKind — a residue that is a build', () => {
  // OR-100's own flagship example. If the classifier misses this one it is not doing its job.
  it('reads Q-519, the case the entry was written about', () => {
    expect(keepKind("the UI half, Lane B's. Nothing can write a bedtime yet — there is no control."))
      .toBe('build')
  })

  it('reads the other three the entry named', () => {
    expect(keepKind('the surfacing itself is unbuilt, and the primary half shipped.')).toBe('build')
    expect(keepKind('step 3, the picker (Lane B). One control in the builder wizard.')).toBe('build')
    expect(keepKind('the ENGINE half shipped 2026-08-26 — a measured_rmr table.')).toBe('build')
  })

  it('reads a back-fill or redecode as work, not a check', () => {
    expect(keepKind('the back-fill of stress buckets over the stored history.')).toBe('build')
    expect(keepKind('the historical redecode. The code fix corrects future rollups only.')).toBe('build')
  })
})

describe('keepKind — the honest middle', () => {
  // `unclear` is a real answer, not a failure to decide. Forcing these either way is how a
  // classifier starts lying: into `build` it manufactures work, into `check` it hides some.
  it('says unclear rather than guessing', () => {
    for (const t of [
      'three things, none of them urgent, and none of them able to destroy data.',
      '③, ⑥, ⑦, each for a stated reason:',
      'this is a suppression, not a fix. It must be removed by TN-6.',
    ]) expect(keepKind(t), t).toBe('unclear')
  })

  it('an empty or missing residue is unclear, never a build', () => {
    expect(keepKind('')).toBe('unclear')
    expect(keepKind(undefined as unknown as string)).toBe('unclear')
  })
})

describe('keepKind — check beats build on a residue that says both', () => {
  // A device check on a half-shipped entry is still a check: the code exists, someone has to look
  // at it. Ordering matters and is asserted rather than left to the reading order of two lists.
  it('prefers the verification when both appear', () => {
    expect(keepKind('the ENGINE half shipped; what is owed is the device check, and only that.'))
      .toBe('check')
  })
})

// OR-113 — nineteen entries came out of three device passes with the verification recorded and the
// `Keep:` still claiming the check was owed, so finished work kept printing as debt. The two edits
// are ten lines apart in the file and each reads correctly on its own, which is why reading did not
// catch it.
describe('keepIsSettled — the check already happened', () => {
  const VERIFIED = ['- **✅ VERIFIED ON THE S25, 2026-09-13** (owner pass): the sheet behaved.']

  it('flags a check residue on an entry that records the verification', () => {
    expect(keepIsSettled({ text: 'the device check, and only that.', gate: null }, VERIFIED)).toBe(true)
  })

  it('stays quiet when nothing records a verification', () => {
    expect(keepIsSettled({ text: 'the device check, and only that.', gate: null }, ['- **Lane:** B'])).toBe(false)
  })

  // The acknowledgement. A Keep narrowed against the recorded verification names the half that is
  // DONE — without this the rule fires hardest on the entries someone handled correctly.
  it('stays quiet once the residue says which half is DONE', () => {
    expect(
      keepIsSettled(
        { text: 'the design question only — the device check is DONE (2026-09-13, below).', gate: null },
        VERIFIED,
      ),
    ).toBe(false)
  })

  // A residue that is a BUILD is not this class at all: the code does not exist, so a device
  // verification of some other half says nothing about it.
  it('ignores a build residue even on a verified entry', () => {
    expect(keepIsSettled({ text: 'the UI half, which is still unbuilt.', gate: null }, VERIFIED)).toBe(false)
  })

  it('treats a residue carrying a Gate as a check by construction', () => {
    expect(keepIsSettled({ text: 'the remaining half.', gate: 'device' }, VERIFIED)).toBe(true)
  })

  it('is false when there is no residue', () => {
    expect(keepIsSettled(null, VERIFIED)).toBe(false)
  })

  // The rule's own blind spot, found the day after it shipped (TN-13, then BF-74). Keying on
  // VERIFIED alone let an entry whose check came back BROKEN keep advertising itself as "shipped; a
  // look is owed, nothing is blocked" — worse than the case the rule was written for, because that
  // is live unbuilt work filed as finished.
  it.each([
    ['- **❌ FAILED ON THE S25, 2026-09-13.** Owner: it still does not work.'],
    ['- **❌ REPORTED BROKEN ON THE S25, 2026-09-15** — the cue does not render.'],
  ])('counts a failed look as a settled one: %s', (line) => {
    expect(keepIsSettled({ text: 'the device check, and only that.', gate: null }, [line])).toBe(true)
  })
})

// LB-161 — the rule's second blind spot, and it is the mirror of the first.
//
// Broadening to FAILED (above) made every entry FOUND by a device failure look settled, because the
// failure IS the original report. DV-2 opens with `❌ FAILED ON THE S25, 2026-09-23`, ships its fix
// on 09-25, and correctly keeps a `Keep:` for the pass test on that fix — and the advisory told the
// reader to strike it. An advisory that argues against the entries someone has already got right is
// one that gets scrolled past, which is the same failure mode the DONE acknowledgement exists for.
//
// Position is the evidence, not dates: plenty of these lines carry none, and a date on an outcome
// can be the date of the report rather than of the look.
describe('keepIsSettled — an outcome that predates the fix is the original report', () => {
  const RESIDUE = { text: 'the device pass test above, unchanged.', gate: null } as const
  const FAILED = '- **❌ FAILED ON THE S25, 2026-09-23.** The dialog absorbed the back.'
  const FIXED = '- **✅ FIXED 2026-09-25 (v1.465.61), same mechanism as BF-165.**'
  const VERIFIED = '- **✅ VERIFIED ON THE S25, 2026-09-25** (owner pass): it leaves.'

  it('stays quiet on the DV-2 shape — device-found, then fixed, pass test still owed', () => {
    expect(keepIsSettled(RESIDUE, [FAILED, FIXED])).toBe(false)
  })

  it('still fires once a look happens AFTER the fix', () => {
    expect(keepIsSettled(RESIDUE, [FAILED, FIXED, VERIFIED])).toBe(true)
  })

  it('still fires when a look is recorded and no fix is claimed at all', () => {
    expect(keepIsSettled(RESIDUE, [VERIFIED])).toBe(true)
  })

  // The marker must be the decorated line an implementer writes, not prose about a future fix —
  // otherwise "ships as one fix with BF-165", which DV-2 also contains, would suppress the rule
  // wherever it happened to sit.
  it('does not treat prose about a fix as a shipped marker', () => {
    const prose = '- **🔎 Re-read against `main` 2026-09-24:** ships as one fix with BF-165.'
    expect(keepIsSettled(RESIDUE, [VERIFIED, prose])).toBe(true)
  })

  it('accepts the ⚠ half-shipped marker too, which is how a partial fix is written here', () => {
    expect(keepIsSettled(RESIDUE, [FAILED, '- **⚠ SHIPPED 2026-09-25 — half of it.**'])).toBe(false)
  })

  // Both on ONE line, which is how a small entry records a same-day fix-and-look. The comparison
  // is strictly greater-than for this: the look did happen, so the residue IS settled, and `>=`
  // would suppress the advisory on exactly the entries it should fire for.
  it('fires when one line records both the fix and the look', () => {
    expect(keepIsSettled(RESIDUE, ['- **✅ FIXED and VERIFIED ON THE S25, 2026-09-25.**'])).toBe(true)
  })
})
