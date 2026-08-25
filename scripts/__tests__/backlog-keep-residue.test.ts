// The queue tool's one job is answering "what can I start now", and it was answering it wrongly.
//
// A shipped entry that still owes an owner sign-off or a device run stays in the queue and states
// the residue with `- **Keep:**`. To `next-item.js` those looked identical to unstarted work, so
// they kept their original (high) priority and sat at the top. Measured 2026-08-25 on Lane B:
// **17 of the top 21 READY entries had already shipped**, pushing the genuinely unstarted ones below
// the fold of the tool an implementer is told to start from.
import { describe, it, expect } from 'vitest'
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { keepFromLines } = require('../lib/keep.js') as {
  keepFromLines: (lines: string[]) => { text: string; gate: 'owner' | 'device' | null } | null
}

describe('backlog keep residue', () => {
  it('reads the bullet form', () => {
    expect(keepFromLines(['- **Keep:** the derived-scale thresholds.'])?.text)
      .toBe('the derived-scale thresholds.')
  })

  // One real entry writes it without the bullet, at the start of a line.
  it('reads the bare form', () => {
    expect(keepFromLines(['**Keep:** this is a suppression, not a fix.'])?.text)
      .toBe('this is a suppression, not a fix.')
  })

  it('is null when the entry states no residue', () => {
    expect(keepFromLines(['- **Lane:** B', '- **Branch:** `fix/x`'])).toBeNull()
  })

  // The defect this file exists for. Without a required colon the parser matched prose that merely
  // BEGINS with the word — Q-420's "**Keep the stored field on 1–10**" was reported as its residue
  // while its actual `- **Keep:**` bullet sat further down the same entry.
  it('does not match prose beginning with the word', () => {
    const lines = [
      '     **Keep the stored field on 1–10** and do the mapping internally: four call sites read it.',
      '- **Keep:** the plausibility check against the 20 paired sessions.',
    ]
    expect(keepFromLines(lines)?.text).toBe('the plausibility check against the 20 paired sessions.')
  })

  // A Keep wraps, and its gate is usually on the continuation line rather than the first — 20 of the
  // 27 `Gate:` mentions in the file are the leading-bullet form the tool already read, and the rest
  // are inline like this, which is why reading only bullet-initial `Gate:` missed them.
  it('takes a Gate from a continuation line', () => {
    const k = keepFromLines([
      "- **Keep:** the **device smoke run in both themes** — the sheet's safe-area inset renders as 0",
      '  in the sandbox and its action row carries Remove. `Gate: device`.',
    ])
    expect(k?.gate).toBe('device')
    expect(k?.text).toContain('safe-area inset renders as 0 in the sandbox')
  })

  it('stops at the next bullet rather than swallowing the rest of the entry', () => {
    const k = keepFromLines([
      '- **Keep:** the on-device check.',
      '- **Branch:** `fix/x` · `Gate: owner`',
    ])
    expect(k?.text).toBe('the on-device check.')
    expect(k?.gate).toBeNull()
  })

  it('strips bold markers so the residue prints as one plain line', () => {
    expect(keepFromLines(['- **Keep:** the **surfacing** itself is unbuilt.'])?.text)
      .toBe('the surfacing itself is unbuilt.')
  })
})
