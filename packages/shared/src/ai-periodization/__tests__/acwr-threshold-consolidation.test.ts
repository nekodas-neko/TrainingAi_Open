// Q-306: ACWR drove three behaviours at three thresholds that were each declared where they were
// used — `acwr > 1.5` inline in the emergency-deload trigger, `ACWR_TAPER_START = 1.5` in the
// Activity score, `EARLY_DELOAD_ACWR_MIN = 1.2` in the readiness payload. Two of those were the
// same boundary and nothing said so; the third is a deliberate exception and nothing said that
// either. They now all come from `ACWR_THRESHOLDS`.
//
// Scraped from source rather than imported: the point is that the number is not RETYPED, and an
// imported value cannot tell a literal 1.5 from a reference to one.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ACWR_THRESHOLDS } from '../acwr'

const root = join(__dirname, '..', '..', '..', '..', '..')
const read = (p: string) => readFileSync(join(root, p), 'utf8')

describe('ACWR thresholds come from one place (Q-306)', () => {
  it('the emergency-deload trigger fires at the canonical high boundary', () => {
    const src = read('packages/shared/src/ai-periodization/emergency-deload.ts')
    expect(src).toContain('signals.acwr > ACWR_THRESHOLDS.highMax')
  })

  it('the Activity-score over-exertion taper starts at the same boundary', () => {
    const src = read('packages/shared/src/health/activity-score.ts')
    expect(src).toContain('const ACWR_TAPER_START = ACWR_THRESHOLDS.highMax')
  })

  it('the values are unchanged by the consolidation', () => {
    // The consolidation is deliberately behaviour-preserving. Changing any of these moves who gets
    // an emergency deload, an Activity-score taper, or the early-deload card — a scoring change,
    // which per CLAUDE.md is the owner's call and not a tidy-up's side effect.
    expect(ACWR_THRESHOLDS).toEqual({ lowMax: 0.8, optimalMax: 1.3, elevatedMin: 1.2, highMax: 1.5 })
  })

  it('the elevated bound sits inside the optimal band, on purpose', () => {
    expect(ACWR_THRESHOLDS.elevatedMin).toBeLessThan(ACWR_THRESHOLDS.optimalMax)
    expect(ACWR_THRESHOLDS.elevatedMin).toBeGreaterThan(ACWR_THRESHOLDS.lowMax)
  })
})
