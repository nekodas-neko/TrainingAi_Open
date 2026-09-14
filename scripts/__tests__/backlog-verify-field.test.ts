// BF-90 — `Gate:` meant two things, and one of them was parking finished work.
//
// Measured 2026-09-01: 41 gates, 31 `device`, and **eleven of those on entries whose own headings
// said "shipped; device check owed"**. A gate PARKS an entry, so a third of the parked queue was
// work nobody was blocked on, sitting beside work that genuinely cannot start.
//
// `Verify:` is the second meaning, given its own field for the reason `Lane:`, `Needs:`, `Gate:`,
// `Keep:` and `Reference:` are all fields: prose-detection loses the moment somebody writes it a
// third way, and the tool goes back to mis-sorting without saying so.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { verifyFromLines, verifyProblem, VERIFY_VALUES } = require('../lib/verify.js') as {
  verifyFromLines: (lines: string[]) => { value: string; note: string } | null
  verifyProblem: (gates: string[], v: { value: string } | null) => { kind: string; value: string } | null
  VERIFY_VALUES: Set<string>
}

describe('the Verify field', () => {
  it('reads the bare form', () => {
    expect(verifyFromLines(['- **Verify:** device'])).toEqual({ value: 'device', note: '' })
  })

  it('carries a note after the value, so an entry can say what to look at', () => {
    expect(verifyFromLines(['- **Verify:** device — log a saved meal; it must stay one row.']))
      .toEqual({ value: 'device', note: 'log a saved meal; it must stay one row.' })
  })

  it('takes the same two values as Gate, and nothing else is recognised as valid', () => {
    expect([...VERIFY_VALUES].sort()).toEqual(['device', 'owner'])
    // Parsed, so the checker can name the bad value rather than silently ignoring the line.
    expect(verifyFromLines(['- **Verify:** ci'])?.value).toBe('ci')
  })

  /**
   * The failure mode this field is a field for. An inline `**Verify:**` appended to another bullet
   * is invisible to the parser, so the entry stays exactly where it was — which is the same trap
   * `Gate:` and `Needs:` fell into twice in two days, both by appending to the `Added:` line.
   */
  it('ignores an inline mention and prose that merely uses the word', () => {
    expect(verifyFromLines(['- **Added:** 2026-09-01 · **Verify: device**'])).toBeNull()
    expect(verifyFromLines(['we should verify: device eventually'])).toBeNull()
    expect(verifyFromLines(['- **Verification:** open the sheet and check the wrap'])).toBeNull()
  })

  it('does not answer for a Gate', () => {
    expect(verifyFromLines(['- **Gate:** device'])).toBeNull()
  })
})

describe('Gate and Verify together', () => {
  it('the same value in both is a contradiction, and the gate would win silently', () => {
    expect(verifyProblem(['device'], { value: 'device' }))
      .toEqual({ kind: 'contradicts-gate', value: 'device' })
  })

  // Not redundancy-hunting: an entry legitimately blocked on a decision can, once built, owe a
  // look at it on the phone. Only the SAME value is incoherent.
  it('different values are fine', () => {
    expect(verifyProblem(['owner'], { value: 'device' })).toBeNull()
    expect(verifyProblem([], { value: 'device' })).toBeNull()
    expect(verifyProblem(['device'], null)).toBeNull()
  })

  it('a value nobody can resolve is named rather than ignored', () => {
    expect(verifyProblem([], { value: 'ci' })).toEqual({ kind: 'unknown-value', value: 'ci' })
    // Checked before the contradiction, so the message says the useful thing.
    expect(verifyProblem(['ci'], { value: 'ci' })?.kind).toBe('unknown-value')
  })
})

/**
 * The queue itself, asserted rather than described.
 *
 * These are the eleven BF-90 measured. If one of them ever regains a `Gate: device`, it silently
 * goes back to PARKED and the count the owner was given stops being true — so the file is read.
 *
 * **Amended 2026-09-13: an entry that has BEEN verified is the third state, and demanding `Verify:`
 * of it turned a success into red `main`.** The owner's 2026-09-13 nutrition pass cleared nine of
 * these on the S25 (#1136), which removes the `Verify:` bullet — correctly, there is nothing left to
 * look at — and nine of the seventeen assertions here went red on every branch for a device check
 * that had actually happened. The invariant BF-90 is about was never touched: **none of the
 * seventeen has a `Gate:`, verified or not.** So the rule is "not parked", and `Verify: device` is
 * one of the two ways to satisfy it rather than the only one.
 */
describe('the seventeen shipped entries are never parked', () => {
  const ROOT = join(__dirname, '..', '..')
  const backlog = readFileSync(join(ROOT, 'docs/implementation-backlog.md'), 'utf8')
  // Eleven BF-90 named from their own headings, and six more the existing `keepKind` rule found
  // from their `Keep:` residue — the entry's count was a floor, not the set.
  const CONVERTED = [
    'BF-72', 'BF-74', 'BF-73', 'BF-57', 'BF-75', 'BF-71', 'BF-65', 'BF-46', 'BF-52', 'BF-34', 'Q-406',
    'BF-76', 'BF-53', 'BF-26', 'BF-27', 'TN-13', 'Q-93',
  ]

  // An entry that has LEFT the queue is the third valid state, and the test used to fail on it.
  // The protocol removes a completed entry, so eight of these seventeen were gone the moment their
  // device check came back and the last thing they owed was struck (OR-113, 2026-09-14). Demanding
  // that a finished entry stay in the file to keep a regression test green is the test dictating the
  // queue's contents — the same reasoning `Needs:` uses when it counts an absent target as shipped.
  /** One entry's lines: its `### ` heading down to the next one — or `null` if it has shipped out. */
  const entry = (id: string) => {
    const lines = backlog.split('\n')
    const start = lines.findIndex(l => l.startsWith('### ') && new RegExp(`\\b${id}\\b`).test(l))
    if (start < 0) return null
    const rest = lines.slice(start + 1).findIndex(l => l.startsWith('### '))
    return lines.slice(start, rest === -1 ? undefined : start + 1 + rest)
  }

  /** An entry the owner has signed off on the phone, which is why its `Verify:` is gone. */
  const verifiedOnDevice = (lines: string[]) =>
    lines.some(l => /\bVERIFIED ON THE S25\b/.test(l))

  for (const id of CONVERTED) {
    it(`${id} is verification debt or already verified, never a block`, () => {
      const lines = entry(id)
      if (!lines) return // removed from the queue: finished, which is the outcome this rule wants
      // Exactly one of the two, so neither a silently-dropped `Verify:` nor a verified entry that
      // kept the bullet slips through as "fine".
      expect(
        [verifyFromLines(lines)?.value === 'device', verifiedOnDevice(lines)].filter(Boolean).length,
        `${id} must carry Verify: device OR record a device verification, not both and not neither`,
      ).toBe(1)
      expect(lines.filter(l => /^\s*[-*]\s*\*{0,2}Gate:/i.test(l)), `${id} still has a Gate:`).toEqual([])
    })
  }

  it('and every one of them still says what to check, via its own Keep', () => {
    // The `Verify:` bullets are deliberately bare — next-item.js falls back to the `Keep:` text
    // rather than duplicating it, because two copies of the same sentence drift.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { keepFromLines } = require('../lib/keep.js') as { keepFromLines: (l: string[]) => { text: string } | null }
    for (const id of CONVERTED) {
      const lines = entry(id)
      if (!lines) continue
      expect(keepFromLines(lines)?.text, `${id} has no Keep: to describe the check`).toBeTruthy()
    }
  })
})

/**
 * The classification itself, run end to end against the real queue.
 *
 * The unit tests above prove the field parses and the rule holds. What they cannot prove is the one
 * judgement in `next-item.js` — that `Verify:` is checked **below** the park test (so it can never
 * hide a real block) and **above** `Keep:` (so the eleven, which carry both, print as the debt they
 * are rather than as generic residue). That ordering is three lines and exactly the kind of thing a
 * later edit reorders without noticing, so it is asserted on the output rather than described.
 */
describe('next-item.js routes them out of PARKED', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { execFileSync } = require('node:child_process') as typeof import('node:child_process')
  const ROOT2 = join(__dirname, '..', '..')
  const out = execFileSync('node', ['scripts/next-item.js', '--all'], { cwd: ROOT2, encoding: 'utf8' })

  /** Everything printed under one section heading, up to the next one. */
  const section = (name: string) => {
    const lines = out.split('\n')
    const i = lines.findIndex(l => l.startsWith(name + ' ('))
    if (i === -1) return ''
    const rest = lines.slice(i + 1).findIndex(l => /^[A-Z]+ \(/.test(l))
    return lines.slice(i, rest === -1 ? undefined : i + 1 + rest).join('\n')
  }

  const CONVERTED2 = [
    'BF-72', 'BF-74', 'BF-73', 'BF-57', 'BF-75', 'BF-71', 'BF-65', 'BF-46', 'BF-52', 'BF-34', 'Q-406',
    'BF-76', 'BF-53', 'BF-26', 'BF-27', 'TN-13', 'Q-93',
  ]

  /**
   * Split from the FILE, not from a second hardcoded list.
   *
   * The list above is a snapshot and drifted once already — #1136 verified nine of these on the S25
   * and this block went red for nine device checks that had happened. Reading which group an id is in
   * off its own entry is what stops the next sign-off doing it again; the snapshot's job is only to
   * say which ids are in scope at all.
   */
  const backlog2 = readFileSync(join(ROOT2, 'docs/implementation-backlog.md'), 'utf8')
  const stillOwed = CONVERTED2.filter(id => {
    const lines = backlog2.split('\n')
    const start = lines.findIndex(l => l.startsWith('### ') && new RegExp(`\\b${id}\\b`).test(l))
    // Gone from the queue owes nothing — and a `start` of -1 must be handled explicitly, because the
    // slice below then reads from the END of the file and answers about somebody else's entry.
    if (start < 0) return false
    const rest = lines.slice(start + 1).findIndex(l => l.startsWith('### '))
    const body = lines.slice(start, rest === -1 ? undefined : start + 1 + rest)
    return !body.some(l => /\bVERIFIED ON THE S25\b/.test(l))
  })

  it('prints a VERIFY section holding every entry that still owes a look', () => {
    const verify = section('VERIFY')
    expect(verify).toContain('shipped; a look is owed, nothing is blocked')
    expect(stillOwed.length, 'the snapshot cannot all be verified or this block asserts nothing')
      .toBeGreaterThan(0)
    for (const id of stillOwed) expect(verify, `${id} missing from VERIFY`).toContain(id)
  })

  /**
   * Matched at the START of a row, not anywhere in the section.
   *
   * A plain `includes` reported BF-53 as "still parked" when it was not: another entry's
   * `Needs: BF-53` line prints inside PARKED, so the id appears there without the entry doing so.
   * The assertion was wrong, not the code — and a substring test that can fail for a reason it does
   * not name is worth less than no test.
   */
  const listsEntry = (sec: string, id: string) =>
    sec.split('\n').some(l => new RegExp(`^\\s+(?:\\d+\\.\\s+)?${id}\\s`).test(l))

  it('and none of them is parked or listed as startable work any more', () => {
    // True of all seventeen, verified or not — this is the BF-90 invariant itself. Shipped work must
    // never sit in PARKED beside work that genuinely cannot start, and must never be offered as
    // something to build.
    for (const id of CONVERTED2) {
      expect(listsEntry(section('PARKED'), id), `${id} is still parked`).toBe(false)
      expect(listsEntry(section('READY'), id), `${id} is offered as startable work`).toBe(false)
    }
    // VERIFY is the more specific claim than KEEP, so an entry that still owes a look belongs in one
    // and not the other. A verified entry has no look left to print and falls back to KEEP for
    // whatever residue it still has, which is the right place for it.
    for (const id of stillOwed) {
      expect(listsEntry(section('KEEP'), id), `${id} is in KEEP, where VERIFY is the more specific claim`).toBe(false)
      expect(listsEntry(section('VERIFY'), id), `${id} is missing from VERIFY`).toBe(true)
    }
    for (const id of CONVERTED2.filter(id => !stillOwed.includes(id))) {
      expect(listsEntry(section('VERIFY'), id), `${id} is verified and should owe no look`).toBe(false)
    }
  })

  /**
   * The half that matters more than the promotion: a `Verify:` must never rescue an entry that is
   * genuinely blocked. Real cases exist — an entry with an unmet `Needs:` and a device look owed —
   * and if `Verify:` were checked above the park test they would read as ready-to-look.
   */
  it('a real block still parks, whatever else the entry says', () => {
    const parked = section('PARKED')
    expect(parked).toMatch(/Gate: (owner|device)/)
    expect(section('VERIFY')).not.toMatch(/^\s+Gate:/m)
  })
})

/**
 * The bucket order, against cases the real queue does not contain.
 *
 * This exists because the end-to-end test above **could not catch a reordering**. Moving the
 * `verify` check above the park test passed every assertion, since no entry today happens to carry
 * both a `Verify:` and a real block — so the rule that stops a `Verify:` rescuing blocked work was
 * completely untested until the mutation surfaced it. Synthetic entries are the only way to state it.
 */
describe('bucketFor — the one judgement in next-item.js', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { bucketFor } = require('../lib/queue-buckets.js') as {
    bucketFor: (e: Record<string, unknown>, reasons: string[]) => string
  }
  const entry = (o: Record<string, unknown> = {}) =>
    ({ lane: 'A', verify: null, keep: null, reference: null, ...o })

  it('a real block wins over everything, a Verify included', () => {
    expect(bucketFor(entry({ verify: { value: 'device' } }), ['Needs: BF-1'])).toBe('parked')
    expect(bucketFor(entry({ verify: { value: 'device' }, keep: { text: 'x' } }), ['Gate: owner'])).toBe('parked')
  })

  it('an undecided lane reaches a human rather than a section that implies someone decided', () => {
    expect(bucketFor(entry({ lane: '?', verify: { value: 'device' } }), [])).toBe('unclassified')
  })

  it('Verify outranks Keep, because it names what kind of residue is owed', () => {
    expect(bucketFor(entry({ verify: { value: 'device' }, keep: { text: 'the device check' } }), [])).toBe('verify')
    expect(bucketFor(entry({ keep: { text: 'the device check' } }), [])).toBe('keep')
  })

  it('Reference is last, so it can never hide an obligation', () => {
    expect(bucketFor(entry({ reference: 'the map', keep: { text: 'a walk' } }), [])).toBe('keep')
    expect(bucketFor(entry({ reference: 'the map', verify: { value: 'device' } }), [])).toBe('verify')
    expect(bucketFor(entry({ reference: 'the map' }), [])).toBe('reference')
  })

  it('an entry owing nothing is startable work', () => {
    expect(bucketFor(entry(), [])).toBe('ready')
  })
})
