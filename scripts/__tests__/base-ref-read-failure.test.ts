// OR-130. `fileAtBase` returned `null` for two different facts — "the branch added this file" and
// "we could not read the base" — and `verdict` turns a `null` base into `'fail'`. So a read failure
// became an accusation: a file byte-identical to `main` reported as this branch's new violation,
// non-deterministically, which cost a session to diagnose.
//
// These cases run against this repository's own HEAD rather than `origin/main`, because HEAD exists
// in every checkout including CI's, and the distinction under test is about git's stderr, not about
// which ref is being read.
import { describe, expect, it } from 'vitest'

const { showAtBase, fileAtBase, verdict } = require('../lib/base-ref.js') as {
  showAtBase: (ref: string, p: string) => { content: string | null; unreadable: boolean; reason?: string }
  fileAtBase: (ref: string | null, p: string) => string | null
  verdict: (a: { count: number; limit: number; atBase: number | null }) => string
}

describe('showAtBase tells absent from unreadable', () => {
  it('reads a file that is there', () => {
    const r = showAtBase('HEAD', 'package.json')
    expect(r.unreadable).toBe(false)
    expect(r.content).toContain('"name"')
  })

  it('calls a path that is genuinely not at the ref absent, not unreadable', () => {
    const r = showAtBase('HEAD', 'no/such/file/at/all.ts')
    expect(r).toEqual({ content: null, unreadable: false })
  })

  it('calls a base it cannot read unreadable, not absent', () => {
    const r = showAtBase('or130-definitely-not-a-ref', 'package.json')
    expect(r.unreadable).toBe(true)
  })

  // The mechanism behind the real failure has never been reproduced, so the next occurrence has to
  // identify itself. Carrying git's own words out is the only part of this fix that can do that.
  it('carries git own reason out, so the next occurrence names its cause', () => {
    const r = showAtBase('or130-definitely-not-a-ref', 'package.json')
    expect(r.reason).toContain('or130-definitely-not-a-ref')
  })

  // The regression itself: before OR-130 these two produced an identical value, so nothing
  // downstream could tell them apart. `content` alone still cannot — the flag is the whole fix.
  it('distinguishes the two cases that used to be one', () => {
    const absent = showAtBase('HEAD', 'no/such/file/at/all.ts')
    const unreadable = showAtBase('or130-definitely-not-a-ref', 'package.json')
    expect(absent.content).toBe(unreadable.content)
    expect(absent.unreadable).not.toBe(unreadable.unreadable)
  })
})

describe('the strict fallback is unchanged', () => {
  // Deliberate, and it is the CI half of OR-130: in CI the base comes from a `|| true` fetch, so a
  // fetch failure leaves NO base ref and every atBase is null. Turning an unknown base into a pass
  // would disable every base-aware ratchet in the repo on any blip, which is far worse than the bug.
  it('still fails an over-limit count when nothing is known about the base', () => {
    expect(verdict({ count: 1, limit: 0, atBase: null })).toBe('fail')
  })

  it('returns null without consulting git when there is no base ref', () => {
    expect(fileAtBase(null, 'package.json')).toBeNull()
  })

  it('still reports an unreadable base as absent, so the outcome stays strict', () => {
    expect(fileAtBase('or130-definitely-not-a-ref', 'package.json')).toBeNull()
  })
})
