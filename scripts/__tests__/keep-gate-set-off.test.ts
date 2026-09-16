// LA-103 — a sentence saying a gate was withheld was read as a gate.
//
// `keep.js` read a `Gate:` from anywhere in a `Keep:` block, so BF-46's
// *"**The `Gate: device` above was deliberately withheld while they were unbuilt**"* — a sentence
// DENYING a gate — asserted one. It was masked while the entry also carried `Verify: device`
// (`next-item.js` skips a Keep's gate that a `Verify:` matches); the owner's 2026-09-13 sign-off
// removed the `Verify:`, un-masked the phantom, put a VERIFIED entry back into PARKED, and turned
// `main` red on every branch.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { keepFromLines } = require('../lib/keep.js') as {
  keepFromLines: (lines: string[]) => { text: string; gate: string | null } | null
}

const gateOf = (lines: string[]) => keepFromLines(lines)?.gate ?? null

describe('a gate must be SET OFF from the prose, not mentioned inside a sentence', () => {
  /**
   * The entry guessed "preceded by a word character is prose" from the single BF-46 case. Measuring
   * all 164 Keep blocks refuted it: **LB-53 is preceded by the word "a" and is a real gate.** What
   * actually separates them is whether the token is set off — opening a clause, or bolded.
   */
  it('rejects BF-46s sentence, which denied a gate and was read as asserting one', () => {
    expect(gateOf([
      '- **Keep:** the device check, and only that.',
      '  **The `Gate: device` above was deliberately withheld while they were unbuilt** — that field',
      '  parks an entry, and parking unbuilt work would have hidden it.',
    ])).toBeNull()
  })

  it('keeps LB-53, the counterexample that refuted the entry-s own discriminator', () => {
    // Preceded by the word "a", yet bolded — a field, not prose.
    expect(gateOf([
      '- **Keep:** one thing, and it is not what this entry was filed for.',
      '  exists and now stamps correctly; running it is a **`Gate: owner`** action, not a code change,',
    ])).toBe('owner')
  })

  it.each([
    ['a clause of its own, which is 17 of the 18', ['- **Keep:** the on-device check. `Gate: device`.']],
    ['bolded after a full stop (BF-80)', ['- **Keep:** shipped. **`Gate: device`** — the whole thing']],
    ['opening a continuation line', ['- **Keep:** something owed', '  Gate: device']],
  ])('keeps a gate %s', (_label, lines) => {
    expect(gateOf(lines as string[])).toBe('device')
  })

  it.each([
    ['the field is discussed rather than set', ['- **Keep:** x', '  the `Gate: device` above was removed']],
    ['a sentence about what a gate would mean', ['- **Keep:** x', '  adding a `Gate: owner` here would park it']],
  ])('rejects prose where %s', (_label, lines) => {
    expect(gateOf(lines as string[])).toBeNull()
  })
})

/**
 * The safety net, and the reason this can ship at all: the rule is fitted to nineteen observed
 * cases, so what protects it is the real file rather than the reasoning. **Anchoring to a bullet
 * start instead — the obvious fix — would drop all eighteen and silently un-park genuinely blocked
 * work, which is worse than the bug.**
 */
describe('the real queue classifies exactly as it did before', () => {
  const ROOT = join(__dirname, '..', '..')
  const lines = readFileSync(join(ROOT, 'docs/implementation-backlog.md'), 'utf8').split('\n')
  const heads = lines.map((l, i) => (l.startsWith('### ') ? i : -1)).filter(i => i >= 0)

  const gated = heads.map((st, idx) => {
    const body = lines.slice(st, idx + 1 < heads.length ? heads[idx + 1] : lines.length)
    const k = keepFromLines(body)
    if (!k?.gate) return null
    return `${(body[0].match(/\b([A-Z]{1,2}-\d+[a-z]?)\b/) ?? [])[1] ?? '?'}:${k.gate}`
  }).filter((x): x is string => x != null)

  // Measured 2026-09-13, after BF-46's sentence was reworded to clear red `main`. Pinned by ID so a
  // future parser change that un-parks or newly parks an entry names it instead of moving a count.
  //
  // **Updated 2026-09-16: `Q-305:device` removed, and the update is the test working rather than
  // failing.** #1247 split the push:pull card out of Q-305 as OR-118 and deleted the `Keep:` block
  // its gate lived in, so the gate left with it — a deliberate restructure whose own commit message
  // says it "freed a build from a Keep". The pin named the entry rather than moving a count, which
  // is exactly what let that be checked instead of guessed.
  //
  // **It also left `main` red for every lane until someone noticed**, which is the second time this
  // pin has done that (the 2026-09-13 line above records the first). An entry-restructuring PR has
  // to re-run this test; it is the only thing that sees a gate leave.
  it('yields the same seventeen gates, by id', () => {
    expect(gated).toEqual([
      'BF-80:device', 'LB-53:owner', 'BF-10:device', 'Q-486:device', 'Q-499:device', 'Q-477:device',
      'Q-467:device', 'LB-5:device', 'Q-317:device', 'Q-318:device', 'Q-316:device', 'Q-544:device',
      'Q-538:device', 'Q-461:device', 'Q-319:device', 'Q-513:owner', 'Q-281:device',
    ])
  })
})
