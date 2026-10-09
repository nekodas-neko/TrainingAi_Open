import { describe, expect, it } from 'vitest'
import { muscleVolumeColor, targetBand, targetBandColor } from '../volume-band'

/** #2554. The body map and the bars under it read ONE colour rule, so a muscle at 4 of 13 sets can
 *  no longer be red below and green above. The bands themselves are unchanged from the bar rule
 *  this was lifted out of: green at or above target, amber from 60%, red under, grey untrained. */

const GREEN = 'var(--accent-green)'
const AMBER = 'var(--accent-amber)'
const RED = 'var(--destructive)'
const GREY = 'var(--muted-foreground)'

describe('targetBand / muscleVolumeColor', () => {
  it("paints the owner's week red: Lats 4/13, Shoulders 3.5/13, Chest 3/13, Abs 3/13", () => {
    for (const [sets, target] of [[4, 13], [3.5, 13], [3, 13], [3, 13]]) {
      expect(targetBand(sets, target)).toBe('under')
      expect(muscleVolumeColor(sets, target)).toBe(RED)
    }
  })

  it('the 60% boundary is amber, just below it is red', () => {
    expect(targetBand(6, 10)).toBe('approaching')
    expect(targetBand(5.5, 10)).toBe('under')
    // 13 * 0.6 = 7.8 — 8 is over, 7.5 is under
    expect(targetBand(8, 13)).toBe('approaching')
    expect(targetBand(7.5, 13)).toBe('under')
    // 15 * 0.6 = 9 exactly; the comparison must not depend on float multiplication
    expect(targetBand(9, 15)).toBe('approaching')
    expect(targetBand(3, 5)).toBe('approaching')
    expect(targetBand(7, 10)).toBe('approaching')
  })

  it('the 100% boundary is green, just below it is amber', () => {
    expect(targetBand(13, 13)).toBe('at')
    expect(targetBand(12.5, 13)).toBe('approaching')
    expect(targetBand(20, 13)).toBe('at')
    expect(targetBandColor(13, 13)).toBe(GREEN)
    expect(targetBandColor(12, 13)).toBe(AMBER)
  })

  it('zero or negative sets are untrained, grey', () => {
    expect(targetBand(0, 13)).toBe('untrained')
    expect(targetBand(-1, 13)).toBe('untrained')
    expect(targetBand(Number.NaN, 13)).toBe('untrained')
    expect(muscleVolumeColor(0, 13)).toBe(GREY)
    expect(muscleVolumeColor(0, null)).toBe(GREY)
  })

  it('a program target wins over the landmark verdict', () => {
    expect(muscleVolumeColor(4, 13, { color: GREEN })).toBe(RED)
  })

  it('with no target the verdict colour is used, else the generic 10-set band (blue from 15)', () => {
    expect(muscleVolumeColor(4, undefined, { color: AMBER })).toBe(AMBER)
    expect(muscleVolumeColor(5, null)).toBe(RED)
    expect(muscleVolumeColor(6, null)).toBe(AMBER)
    expect(muscleVolumeColor(10, null)).toBe(GREEN)
    expect(muscleVolumeColor(14, null)).toBe(GREEN)
    expect(muscleVolumeColor(15, null)).toBe('var(--color-brand)')
  })

  it('only ever returns theme tokens, never a hex literal', () => {
    for (const sets of [0, 1, 6, 10, 13, 15, 30]) {
      expect(muscleVolumeColor(sets, 13)).toMatch(/^var\(--/)
      expect(muscleVolumeColor(sets, null)).toMatch(/^var\(--/)
    }
  })
})
