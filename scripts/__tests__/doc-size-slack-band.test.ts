// RV-134 — the slack rule failed on ANY gap, so every PR that shrank a tracked doc by even one line
// had to edit `docs/doc-size/<path>.size`: a one-line file two concurrent PRs cannot both write.
// Measured 2026-09-23: 23 re-merge commits across five branches in one night, nearly all resolving
// a .size file where neither side was wrong and the merged tree's own count was the answer.
//
// The conflicts were not caused by the ceiling. They were caused by slack detection firing on every
// PR, which put a shared one-line file in almost every diff.
import { describe, expect, it } from 'vitest'

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { slackBand } = require('../lib/doc-size-baselines.js') as { slackBand: (limit: number) => number }

describe('the slack band still catches what the rule was written for', () => {
  // PS-34's case, and the reason slack detection exists at all: CLAUDE.md sat 429 lines under its
  // number, so the most-read file in the repo could grow by half its own length in silence. A band
  // that tolerated that would have removed the check rather than tuned it.
  it('does not tolerate the 429-line gap that created the rule', () => {
    expect(429).toBeGreaterThan(slackBand(900))
  })

  it('tolerates the drift that was causing the conflicts', () => {
    // Tonight's two real cases: the backlog 23 lines under 27,128, CLAUDE.md 7 under 877.
    expect(23).toBeLessThanOrEqual(slackBand(27128))
    expect(7).toBeLessThanOrEqual(slackBand(877))
  })
})

describe('the band scales, because the tracked docs span three orders of magnitude', () => {
  // A baton is 53 lines and the backlog is 27,000. A flat 25 would fail the backlog on 0.1% drift;
  // a flat 500 would let a baton double. The floor carries the small files, the percentage the big.
  it('floors at 25 lines for small documents', () => {
    expect(slackBand(53)).toBe(25)
    expect(slackBand(65)).toBe(25)
    expect(slackBand(908)).toBe(25)
  })

  it('scales with the document for large ones', () => {
    expect(slackBand(27170)).toBe(543)
    expect(slackBand(12422)).toBe(248)
  })

  it('never lets a small document hide a doubling', () => {
    for (const limit of [53, 65, 100, 329]) {
      expect(slackBand(limit), `a ${limit}-line doc must not tolerate half its own length`)
        .toBeLessThan(limit)
    }
  })

  it('is monotonic — a bigger document never gets a smaller band', () => {
    let prev = 0
    for (const limit of [53, 65, 329, 877, 908, 1500, 12422, 27170]) {
      const band = slackBand(limit)
      expect(band).toBeGreaterThanOrEqual(prev)
      prev = band
    }
  })
})
