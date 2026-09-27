import { describe, expect, it } from 'vitest'
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { orphanedFieldsBelow } = require('../lib/mid-entry-heading.js') as {
  orphanedFieldsBelow: (queue: string[], index: number) => string[]
}

/**
 * A `## ` heading inside a queue entry truncates it — in `next-item.js` and in
 * `check-backlog-pointers.js` alike, and they must, because the queue carries real section boundaries
 * between batches of entries.
 *
 * So the rule cannot be "no `## ` inside the queue". It has to tell a boundary from a mis-levelled
 * sub-heading, and the discriminator is what FOLLOWS: a boundary is followed by prose and then a
 * `### ` entry, while a truncated entry's own field bullets sit under one. **The shapes that must NOT
 * trip it are the point of this file** — six of the queue's seven mid-entry headings are genuine, and
 * a check that flagged them would be deleted rather than obeyed.
 */
describe('mid-entry `## ` heading — orphaned fields', () => {
  it('finds a field below a mis-levelled sub-heading (the BF-165 shape)', () => {
    const q = [
      '## Queue', '', '### [x] BF-165 — a dead tap', '- **Lane:** B', '',
      '## ⛔ RETRACTION — everything above is wrong', '', 'Prose about the retraction.', '',
      '- **Verify: device**', '- **Keep: the device pass.** On the S25 …', '',
      '### [y] NEXT-1 — something else', '- **Verify: owner**',
    ]
    expect(orphanedFieldsBelow(q, 5)).toEqual([
      '- **Verify: device**',
      '- **Keep: the device pass.** On the S25 …',
    ])
  })

  it('scans past a SECOND heading to the next entry — BF-165 had two', () => {
    // The bug in the first version of this scan: it stopped at the next heading of any level, and
    // BF-165's orphans sit after its second `## `, so the entry reported clean.
    const q = [
      '## Queue', '', '### [x] BF-165', '- **Lane:** B', '',
      '## ⛔ RETRACTION', '', 'Prose.', '',
      '## ✅ ROOT CAUSE FOUND', '', 'More prose.', '', '- **Verify: device**', '',
      '### [y] NEXT-1',
    ]
    expect(orphanedFieldsBelow(q, 5), 'the first heading must still see the orphan').toEqual([
      '- **Verify: device**',
    ])
  })

  it('does NOT flag a genuine section boundary between entries', () => {
    // Six of the queue's seven are this: a dated divider grouping the entries below it.
    const q = [
      '## Queue', '', '### [x] A-1', '- **Lane:** B', '- **Verify: device**', '',
      '## Owner request, 2026-08-25 — the device smoke run', '',
      '*The owner ran the ten-step checklist and answered every step.*', '',
      '### [y] A-2', '- **Lane:** A',
    ]
    expect(orphanedFieldsBelow(q, 6)).toEqual([])
  })

  it('ignores prose that merely mentions a field name', () => {
    const q = [
      '## Queue', '', '### [x] A-1', '',
      '## A sub-heading with no fields under it', '',
      'It says the Verify: device check is owed, in prose, mid-sentence.',
      '- a bullet that is not a field at all', '',
      '### [y] A-2',
    ]
    expect(orphanedFieldsBelow(q, 4)).toEqual([])
  })

  it('reaches the end of the file when no entry follows', () => {
    const q = ['## Queue', '', '### [x] A-1', '', '## Sub-heading', '', '- **Gate: owner**']
    expect(orphanedFieldsBelow(q, 4)).toEqual(['- **Gate: owner**'])
  })
})
