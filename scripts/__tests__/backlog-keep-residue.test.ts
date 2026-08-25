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

  // The colon requirement above was too narrow, and it was narrow in a way that hit the two
  // highest-priority entries in Lane A's queue: TN-3a and TN-4 both write the residue as
  // `- **Keep — what is NOT done:**`. Both read as unstarted work and sat at #1 and #2 of READY,
  // which is the same defect this file was written to fix, one punctuation mark over.
  it('reads the em-dash form', () => {
    const k = keepFromLines(['- **Keep — what is NOT done:** why the constants were unset.'])
    expect(k?.text).toBe('what is NOT done: why the constants were unset.')
  })

  it('reads the en-dash and hyphen forms', () => {
    expect(keepFromLines(['- **Keep – three things are NOT done:** no back-fill has run.'])?.text)
      .toBe('three things are NOT done: no back-fill has run.')
    expect(keepFromLines(['- **Keep - the device run:** unverified on the S25.'])?.text)
      .toBe('the device run: unverified on the S25.')
  })

  // Widening to dashes must not re-open the false-positive door the colon was closing. These are
  // the real prose lines in the backlog that begin with the word and state no residue.
  it('still ignores prose beginning with the word', () => {
    for (const line of [
      '  keep what the owner saw; the `MODEL_VERSION` bump below is what makes the eras separable.',
      '- Keep `classifyZone`\'s three-state shape (`push` / `in` / `ease`) and swap what it reads.',
      '  **Keep `keepSavedMealIds.max(6)`**: it equals `MEAL_COUNT_MAX`, so it is not arbitrary.',
      '  keep only the prose cached. Recomputing is the cheaper first cut.',
    ]) {
      expect(keepFromLines([line]), line).toBeNull()
    }
  })

  it('strips bold markers so the residue prints as one plain line', () => {
    expect(keepFromLines(['- **Keep:** the **surfacing** itself is unbuilt.'])?.text)
      .toBe('the surfacing itself is unbuilt.')
  })
})
