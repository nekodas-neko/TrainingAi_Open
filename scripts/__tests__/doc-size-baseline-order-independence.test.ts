// Q-424 — the size ratchet was order-dependent, so two independently-green PRs could merge into a
// red `main`, and the failure then surfaced on an unrelated branch as an unrelated file being over
// an unrelated limit. It read as "your change was too big" when the change was eleven lines.
//
// The fix is that the ratchet asks a different question: not *"is this file over its number"* — which
// is a fact about `main` as much as about the branch — but *"did THIS BRANCH make it worse"*. This
// pins that rule. The end-to-end behaviour was demonstrated against a real two-PR merge in both
// orders; what belongs in CI is the decision itself, which is pure.
import { describe, it, expect } from 'vitest'
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { verdict } = require('../lib/base-ref.js') as {
  verdict: (a: { count: number; limit: number; atBase: number | null }) => 'ok' | 'slack' | 'inherited' | 'fail'
}

describe('doc-size ratchet verdict (Q-424)', () => {
  it('passes when the count is exactly the baseline', () => {
    expect(verdict({ count: 100, limit: 100, atBase: 100 })).toBe('ok')
  })

  // PS-34 changed this case. It used to be `'ok'`, and that was the whole defect on the shrink
  // side: a document under its number left the difference available for silent regrowth. Measured
  // when the rule was written — CLAUDE.md was **429 lines** under baseline, so the most-read file
  // in the repo could grow by more than half its own length with nothing complaining.
  it('reports slack when the file is UNDER its baseline', () => {
    expect(verdict({ count: 90, limit: 100, atBase: 100 })).toBe('slack')
  })

  // The asymmetry with `inherited`, stated so it is not "tidied" later. On the growth side the fix
  // is moving prose, so blaming a branch for main's size was wrong. Here the fix is editing one
  // number, so someone else having shrunk it is no reason to leave the ceiling wrong.
  it('reports slack regardless of what the base held', () => {
    expect(verdict({ count: 90, limit: 100, atBase: 90 })).toBe('slack')
    expect(verdict({ count: 90, limit: 100, atBase: null })).toBe('slack')
  })

  it('fails a branch that grew the file past the baseline', () => {
    expect(verdict({ count: 110, limit: 100, atBase: 100 })).toBe('fail')
  })

  // The class the entry is about: `main` merged into a state over its own number, and every later
  // branch inherited the red. None of them grew anything.
  it('does not fail a branch that inherited the overage from its base', () => {
    expect(verdict({ count: 120, limit: 100, atBase: 120 })).toBe('inherited')
  })

  it('does not fail a branch that SHRANK an already-over file without reaching the baseline', () => {
    // Partial cleanup must not be punished harder than doing nothing at all — otherwise the only
    // safe move on an inherited overage is to leave it.
    expect(verdict({ count: 115, limit: 100, atBase: 120 })).toBe('inherited')
  })

  it('still fails a branch that grows an already-over file further', () => {
    expect(verdict({ count: 125, limit: 100, atBase: 120 })).toBe('fail')
  })

  // A shallow clone with no remote has no base to compare against. Degrading to the plain absolute
  // comparison is the safe direction: it can be too strict, never too lenient.
  it('falls back to the absolute comparison when there is no base', () => {
    expect(verdict({ count: 110, limit: 100, atBase: null })).toBe('fail')
    expect(verdict({ count: 100, limit: 100, atBase: null })).toBe('ok')
  })
})
