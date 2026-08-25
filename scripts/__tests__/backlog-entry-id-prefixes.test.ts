// The alternation of entry-ID prefixes was written out four times and `OR-` was in none of them.
//
// The Orchestrator role was created 2026-08-20; the tooling was never taught its letter, and it
// surfaced five days later on the first `OR-` entry anyone wrote (PS-6). The failure mode was
// **silent deletion, not a wrong label**: `next-item.js` builds an entry only when the heading
// yields an id and pushes only what it built, so an `OR-` heading was dropped from the queue
// entirely — measured, the total read 194 with and without a scratch `OR-99`, and it appeared
// nowhere in the output, not even under UNCLASSIFIED.
import { describe, it, expect } from 'vitest'
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { PREFIXES, idPattern, idPartsPattern } = require('../lib/entry-id.js') as {
  PREFIXES: string[]
  idPattern: (flags?: string) => RegExp
  idPartsPattern: (flags?: string) => RegExp
}

describe('backlog entry-id prefixes', () => {
  // The list in docs/agents/README.md §3, plus the legacy Q- numbers.
  it('knows every prefix the agents actually use', () => {
    expect(new Set(PREFIXES)).toEqual(new Set(['LA', 'LB', 'BF', 'RV', 'TN', 'OR', 'PS', 'Q']))
  })

  it('matches an OR- id in a heading — the one that was missing', () => {
    expect('### [platform] OR-1 — something'.match(idPattern())?.[1]).toBe('OR-1')
  })

  it.each(['LA-19', 'LB-11', 'BF-23', 'RV-31', 'TN-8', 'OR-1', 'PS-6', 'Q-477'])(
    'matches %s', id => { expect(`### [x] ${id} — t`.match(idPattern())?.[1]).toBe(id) },
  )

  it('keeps the a/b suffix a same-role collision is resolved with', () => {
    expect('### [x] RV-14a — t'.match(idPattern())?.[1]).toBe('RV-14a')
  })

  it('splits the parts the duplicate detector needs', () => {
    const m = 'OR-99a'.match(idPartsPattern())
    expect([m?.[1], m?.[2], m?.[3]]).toEqual(['OR', '99', 'a'])
  })

  // A fresh object per call: a shared /g regex carries `lastIndex` between callers, which makes
  // every second `matchAll` on the same pattern start from the wrong offset.
  it('returns a new regex each call, so /g state cannot leak between callers', () => {
    const a = idPattern('g')
    expect(a).not.toBe(idPattern('g'))
    expect([...'needs LA-1 and OR-2'.matchAll(a)].map(m => m[1])).toEqual(['LA-1', 'OR-2'])
    expect([...'needs LA-1 and OR-2'.matchAll(idPattern('g'))].map(m => m[1])).toEqual(['LA-1', 'OR-2'])
  })

  it('does not match a bare word or a lone number', () => {
    expect('### [x] ORDER-1 — t'.match(idPattern())).toBeNull()
    expect('### [x] 99 — t'.match(idPattern())).toBeNull()
  })
})
