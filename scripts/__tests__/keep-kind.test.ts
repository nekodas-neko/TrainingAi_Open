// OR-100 — `next-item.js` prints Keeps under a heading that says *"shipped; only the stated residue
// is owed. **Not new work**"*. That is true of most of them and false of a few, and the few vanish
// from where implementers look: measured on Lane B's queue, four of twelve Keeps were builds,
// including a fully specified UI half whose engine had already shipped.
//
// Driven against fixtures rather than the live backlog on purpose — a test that reads the real file
// changes verdict as the repo does, which is the one thing a regression test for a classifier must
// not do (the same reasoning `entries-verdict.js` was extracted for).
import { describe, it, expect } from 'vitest'

const { keepKind } = require('../lib/keep-kind.js') as { keepKind: (t: string) => string }

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
