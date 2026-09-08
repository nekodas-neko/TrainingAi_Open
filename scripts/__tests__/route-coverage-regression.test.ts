// LA-81 — a shrink-only ratchet that compares a COUNT cannot see a swap: five routes covered
// against three un-covered nets to an improvement and passes. This pins the set comparison that
// answers the other half, the same way `doc-size-baseline-order-independence.test.ts` pins
// `verdict` — the end-to-end behaviour was demonstrated by replaying the real accident (a test file
// overwritten at a path that already held one) against a real merge base.
import { describe, it, expect } from 'vitest'
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { lostRouteCoverage } = require('../lib/coverage-regression.js') as {
  lostRouteCoverage: (a: { routes: string[]; covered: Set<string>; baseCovered: Set<string> | null }) => string[]
}

const call = (routes: string[], covered: string[], baseCovered: string[] | null) =>
  lostRouteCoverage({
    routes,
    covered: new Set(covered),
    baseCovered: baseCovered === null ? null : new Set(baseCovered),
  })

describe('route coverage regression (LA-81)', () => {
  it('reports a route that had a handler test on the base and no longer does', () => {
    expect(call(['a', 'b'], ['b'], ['a', 'b'])).toEqual(['a'])
  })

  // The exact shape the count could not see: the total falls while three routes go backwards.
  it('reports them even when more routes were covered than lost', () => {
    expect(call(
      ['calendar-data', 'training-load', 'muscle-recovery', 'n1', 'n2', 'n3', 'n4', 'n5'],
      ['n1', 'n2', 'n3', 'n4', 'n5'],
      ['calendar-data', 'training-load', 'muscle-recovery'],
    )).toEqual(['calendar-data', 'training-load', 'muscle-recovery'])
  })

  it('says nothing about a route that was already uncovered — that is debt, and the count owns it', () => {
    expect(call(['a', 'b'], ['a'], ['a'])).toEqual([])
  })

  // A route that no longer exists is not an untested route.
  it('says nothing about a route the branch deletes', () => {
    expect(call(['b'], ['b'], ['a', 'b'])).toEqual([])
  })

  it('says nothing about a new route that arrives uncovered — the count fails that one', () => {
    expect(call(['a', 'new'], ['a'], ['a'])).toEqual([])
  })

  // "The base covered nothing" and "we cannot read the base" lead to opposite conclusions, and
  // only one of them is knowable. A base we cannot see must never turn a passing branch red.
  it('reports nothing when there is no base to compare against', () => {
    expect(call(['a', 'b'], [], null)).toEqual([])
    expect(call(['a', 'b'], [], [])).toEqual([])
  })
})
