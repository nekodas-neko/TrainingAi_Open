import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ACWR_THRESHOLDS } from '@trainingai/shared/ai-periodization/acwr'

/**
 * Q-173: the "Fatigue detected" card recommended a deload week without saying why. It now states
 * the two numbers that tripped it and what they had to beat — which only stays honest if the
 * thresholds it prints are the ones the check actually uses.
 */

const root = join(__dirname, '..', '..', '..')
const read = (p: string) => readFileSync(join(root, p), 'utf8')

function constant(name: string): number {
  const src = read('lib/health/readiness-payload.ts')
  const m = src.match(new RegExp(`export const ${name} = ([\\d.]+)`))
  if (!m) throw new Error(`${name} not found`)
  return Number(m[1])
}

describe('early-deload thresholds (Q-173)', () => {
  it('the ACWR bound is deliberately below the optimal ceiling, not equal to it', () => {
    // 1.2 vs ACWR_THRESHOLDS.optimalMax (1.3). The card fires while load is still inside the
    // optimal band, because it is paired with a readiness score under 45 — the pair is the signal.
    // A future tidy-up that "unifies" this with optimalMax would change who sees the card, so the
    // difference is pinned rather than left to a comment.
    expect(constant('EARLY_DELOAD_ACWR_MIN')).toBe(1.2)
    expect(constant('EARLY_DELOAD_ACWR_MIN')).toBeLessThan(ACWR_THRESHOLDS.optimalMax)
  })

  it('the readiness bound is 45', () => {
    expect(constant('EARLY_DELOAD_SCORE_MAX')).toBe(45)
  })

  it('the check uses the named constants, not inline numbers', () => {
    const src = read('lib/health/readiness-payload.ts')
    expect(src).toContain('score < EARLY_DELOAD_SCORE_MAX && acwr > EARLY_DELOAD_ACWR_MIN')
  })

  it('the card prints the thresholds it was given, never its own copy of them', () => {
    // The whole point of sending them in the payload: a card with hardcoded bounds can drift into
    // stating a threshold the server no longer applies, which is worse than saying nothing.
    const card = read('components/home/early-deload-card.tsx')
    expect(card).toContain('reason.scoreThreshold')
    expect(card).toContain('reason.acwrThreshold')
    expect(card).not.toMatch(/\b45\b/)
    expect(card).not.toMatch(/\b1\.2\b/)
  })

  it('the reason rides on the same payload as the flag, so the card cannot show one without the other', () => {
    const src = read('lib/health/readiness-payload.ts')
    expect(src).toContain('earlyDeload: EarlyDeloadReason | null')
    // Assigned inside the branch that sets the flag — never populated when the card is hidden.
    expect(src).toMatch(/if \(earlyDeloadRecommended\) \{\s*\n\s*earlyDeload = \{/)
  })
})
