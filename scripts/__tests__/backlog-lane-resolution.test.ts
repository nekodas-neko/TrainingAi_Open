// An entry's PROSE could outrank its own lane tag, because the parser took the first "Lane A"-shaped
// string it saw. Measured 2026-08-20: Q-529 was being served to Lane A's queue while its own body
// said "Re-scoped from Lane A to Lane B" fourteen lines above `**Lane:** B`. A Lane B item had been
// sitting at the top of the other lane's list.
import { describe, it, expect } from 'vitest'
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { laneFromLines, laneFieldProblem } = require('../lib/lane.js') as {
  laneFromLines: (lines: string[]) => 'A' | 'B' | '?' | null
  laneFieldProblem: (line: string) => string | null
}

describe('backlog lane resolution', () => {
  it('reads the field form', () => {
    expect(laneFromLines(['- **Lane:** B'])).toBe('B')
    expect(laneFromLines(['- **Lane: A** — `app/api/**`'])).toBe('A')
  })

  // 75 of 205 entries write it without a colon, so this form cannot be dropped.
  it('reads the bare form when there is no field', () => {
    expect(laneFromLines(['- **Surface:** `components/**` — **Lane B**'])).toBe('B')
  })

  // The defect. Both of these are real entries' shapes.
  it("does not let an entry's prose outrank its own field", () => {
    expect(laneFromLines([
      '  - **Re-scoped from Lane A to Lane B.** Not a missing recompute path.',
      '- **Branch:** `fix/x` · **Lane:** B',
    ])).toBe('B')

    expect(laneFromLines([
      '> **⚠️ ROUTE (a) SHIPPED (Lane A), owner-approved.**',
      '- **Lane: B**',
    ])).toBe('B')
  })

  it('still takes the first field when an entry states one twice', () => {
    expect(laneFromLines(['- **Lane:** A', '- **Lane:** B'])).toBe('A')
  })

  // `null` means "not stated", which the caller reads as visible to BOTH lanes. Returning undefined
  // here instead once hid 96 of 203 entries from both lanes at once.
  it('returns null — not undefined — when no lane is stated', () => {
    const got = laneFromLines(['- **Branch:** `fix/x`', 'some prose about landing it'])
    expect(got).toBeNull()
    expect(got).not.toBeUndefined()
  })

  // The residual class, found after the field-vs-prose fix: an entry with NO field form whose bare
  // mentions disagree. Measured 2026-08-20 — 19 entries, and EIGHT of Lane A's top ten READY items
  // among them, because a banner reading "the Lane A half SHIPPED, what is left is Lane B" puts an
  // `A` ahead of the real tag. Taking the first is a coin toss dressed as an answer.
  it('refuses to guess when bare mentions disagree and there is no field', () => {
    expect(laneFromLines([
      '> **⚠️ The Lane A half SHIPPED. What is left is Lane B only** — switching the client over.',
      '- **Lane B** (`components/nutrition/meal-type-manager.tsx`).',
    ])).toBe('?')
  })

  it('still answers when the bare mentions agree', () => {
    expect(laneFromLines([
      '- **Lane B.** `components/oura-ble/` only — the route is Lane B too.',
      'and the console is Lane B.',
    ])).toBe('B')
  })

  it('a field form settles it even when the prose disagrees repeatedly', () => {
    expect(laneFromLines([
      'the Lane A half shipped', 'and more Lane A prose', '- **Lane:** B',
    ])).toBe('B')
  })

  it('preserves an explicit unknown', () => {
    expect(laneFromLines(['- **Lane: ?** — whichever role does its handoff next'])).toBe('?')
  })

  // `O` is the Orchestrator's own lane (OR-103, 2026-09-06). CI config, workflow files and
  // repository settings sit in NEITHER implementer lane's paths, so §3's path rule cannot answer
  // them — four entries said "neither lane" in prose and printed as UNCLASSIFIED forever. Prose is
  // exactly what this parser exists to outrank, so the value has to be readable as a field.
  it('reads the Orchestrator lane as a field', () => {
    expect(laneFromLines(['- **Lane: O** — the Orchestrator owns `.github/workflows/`.'])).toBe('O')
  })

  it('reads the Orchestrator lane in the bare form', () => {
    expect(laneFromLines(['- **Lane O** — repository rulesets are nobody else\'s.'])).toBe('O')
  })

  it('will not confuse an Orchestrator lane with the word it starts', () => {
    expect(laneFromLines(['- **Lane:** Orchestrator-adjacent, but really Lane B'])).toBe('B')
  })
})

// LB-59. The reader above cannot see `**Lane:** Orchestrator` — `LANE_FIELD_RE` needs a boundary
// after the letter and the `O` is followed by `r` — so the field returns "unstated", and an unstated
// entry prints in BOTH implementer lanes' READY lists. PS-38 sat at the top of Lane B's for a day on
// that, and a Lane B session picked up work that was nobody's. Measured 2026-09-07: 4 entries wrote
// `O`, 1 wrote the word.
//
// Printing in both lists stays the failure mode — hiding an unmatched entry once took 96 of 203 out
// of both lanes at once. This is the signal at the point of WRITING, where the mistake is cheap.
describe('backlog lane field validation', () => {
  it('passes every shape the reader can actually read', () => {
    for (const line of [
      '- **Lane:** A — `app/api/**`, plus a migration.',
      '- **Lane: A**',
      '- **Lane:** B.',
      '- **Lane: O** — the Orchestrator owns `.github/workflows/`.',
      '- Lane: ?',
      '- **Lane: ?** — whichever role does its handoff next',
    ]) expect(laneFieldProblem(line)).toBeNull()
  })

  it('flags the spelled-out lane that reads as unstated', () => {
    expect(laneFieldProblem('- **Lane:** Orchestrator')).toBe('Orchestrator')
  })

  it('flags the typos the regex would still misread or miss', () => {
    expect(laneFieldProblem('- **Lane:** b/A')).toBe('b/A')
    expect(laneFieldProblem('- **Lane: Lane A**')).toContain('Lane A')
    // A real entry: BF-106 wrote `none` for an owner action against production.
    expect(laneFieldProblem('- **Lane:** none — an owner action, not a code change.')).toContain('none')
  })

  it('flags a field declared with no value at all', () => {
    expect(laneFieldProblem('- **Lane:**')).toBe('(empty)')
  })

  // Three quarters of the queue names its lane bare and prose mentions one constantly. Judging
  // those would turn a deliberately loose reader into a style checker over 200 entries.
  it('judges only the field form, never the bare one or prose', () => {
    for (const line of [
      '- **Surface:** `components/**` — **Lane B**',
      '- **Lane B.** The engine half shipped.',
      '  - **Re-scoped from Lane A to Lane B.** Not a missing recompute path.',
      'What is left is Lane A\'s, and it needs a migration.',
    ]) expect(laneFieldProblem(line)).toBeNull()
  })

  // Both fall out of anchoring at the bullet — each puts a character before the field name. An
  // explicit `~~` guard was written first and mutating it away failed nothing, which is how it was
  // found to be dead; it would also have let a HALF-struck live value through unflagged.
  it('leaves a struck-through field and a documented example alone', () => {
    expect(laneFieldProblem('- ~~**Lane:** Orchestrator~~ — superseded')).toBeNull()
    expect(laneFieldProblem('- `**Lane:** <letter>` names the lane.')).toBeNull()
  })

  it('still flags a value only half struck through', () => {
    expect(laneFieldProblem('- **Lane:** ~~Orchestrator~~ nobody')).toContain('Orchestrator')
  })
})
