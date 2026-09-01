// LA-53. An entry whose `Lane:` still names the lane whose half has already shipped keeps heading
// THAT lane's READY list, because `next-item.js` reads the field and nothing re-reads it when the
// remaining work moves lanes. Q-535 sat at the top of Lane A's list for two weeks after its Lane A
// half landed on 2026-08-18.
//
// **The two exclusions below are the whole design, and both were found by running the rule against
// the entry that documents it.** LA-53 reported itself twice, for two different reasons — once on
// undated prose describing the shape, once on a dated citation of Q-535. A guard that cannot
// survive its own documentation is not ready to be enforced, which is also why this prints as a
// note rather than failing CI.
import { describe, it, expect } from 'vitest'
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { laneDrift } = require('../lib/lane-drift.js') as {
  laneDrift: (id: string, lane: string | null, lines: string[]) => string | null
}

describe('backlog lane drift', () => {
  // The case this exists for, in the wording Q-535 actually carried.
  it('flags an entry whose own Lane A half is recorded as shipped', () => {
    expect(laneDrift('Q-535', 'A', [
      '- **Lane:** A — classified 2026-08-30 by the path rule.',
      '- 🚧 **The Lane A half SHIPPED 2026-08-18; the 502 is NOT gone yet.**',
    ])).toContain('Lane A half SHIPPED 2026-08-18')
  })

  it('flags the Lane B direction too', () => {
    expect(laneDrift('LB-9', 'B', ['- **The Lane B half shipped 2026-08-01.**'])).toBeTruthy()
  })

  // The corrected state, which is what a fixed entry looks like — it still SAYS the Lane A half
  // shipped, because that is true and worth recording. Flagging it would make the fix unfixable.
  it('is silent once `Lane:` names the lane that still owes work', () => {
    expect(laneDrift('Q-535', 'B', [
      '- **Lane:** B — corrected 2026-09-01.',
      '  the Lane A half shipped on 2026-08-18 and everything still owed is Lane B‑s.',
    ])).toBeNull()
  })

  // Exclusion 1: prose that describes the shape rather than claiming it.
  it('ignores an undated description of the pattern', () => {
    expect(laneDrift('LA-53', 'A', [
      '- So an entry whose Lane A half has shipped keeps heading that lane‑s list.',
    ])).toBeNull()
  })

  // Exclusion 2: a dated line naming ANOTHER entry is a citation, not a claim about this one.
  it('ignores a dated citation of another entry', () => {
    expect(laneDrift('LA-53', 'A', [
      '  - **Q-535** — Lane A half shipped 2026-08-18; the remaining half is Lane B‑s.',
    ])).toBeNull()
  })

  // …but an entry may cite ITSELF by id and still be making the claim.
  it('still flags a claim that names only this entry', () => {
    expect(laneDrift('Q-535', 'A', [
      '- **Q-535**: the Lane A half shipped 2026-08-18.',
    ])).toBeTruthy()
  })

  it('is silent for an unresolved or missing lane', () => {
    expect(laneDrift('BF-1', '?', ['- The Lane A half shipped 2026-01-01.'])).toBeNull()
    expect(laneDrift('BF-1', null, ['- The Lane A half shipped 2026-01-01.'])).toBeNull()
  })

  // A date is required, so a genuine claim that omits one is missed. That is deliberate: the
  // alternative reports every entry that discusses the pattern, which is worse than a miss in an
  // advisory check.
  it('misses an undated claim, which is the accepted cost of exclusion 1', () => {
    expect(laneDrift('Q-999', 'A', ['- **The Lane A half shipped.**'])).toBeNull()
  })
})
