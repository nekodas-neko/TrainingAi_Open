import { describe, it, expect } from 'vitest'
import { accentCardStyle } from '@trainingai/shared/utils'
import { SCORE_BAND_COLOR } from '@trainingai/shared/health/score-band'

/**
 * RV-99. `scoreBand()` now returns `var(--accent-green)` rather than `#22c55e`, and one card
 * (`health-sections.tsx`'s HRV baseline) feeds that colour straight into `accentCardStyle`. That
 * function parsed the hex by slicing it and bailed to a bare muted background for anything else —
 * no gradient, no border, no error. The token path would have lost its tint silently.
 */
describe('accentCardStyle', () => {
  it('gives a var() colour a real gradient and border', () => {
    const s = accentCardStyle(SCORE_BAND_COLOR.High)
    expect(s.backgroundImage).toContain('var(--accent-green)')
    expect(s.border).toContain('var(--accent-green)')
  })

  it('still parses a hex into rgba, byte for byte', () => {
    // ~30 cards render through this branch; color-mix(in oklch) and rgba() from parsed components
    // are NOT the same colour, so the hex path is deliberately untouched.
    const s = accentCardStyle('#22c55e')
    expect(s.backgroundImage).toBe('linear-gradient(135deg, rgba(34,197,94,0.3), rgba(34,197,94,0.12))')
    expect(s.border).toBe('1px solid rgba(34,197,94,0.4)')
  })

  it('keeps the bare bail for transparent', () => {
    // 'transparent' is the card picker's "no accent" choice, not a colour — mixing it would paint
    // a grey wash exactly where the user asked for nothing.
    const s = accentCardStyle('transparent')
    expect(s.backgroundImage).toBeUndefined()
    expect(s.border).toBeUndefined()
  })
})
