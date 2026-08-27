import { describe, it, expect } from 'vitest'
import { scanImageKind, scanImagePrompt } from '../scan-prompt'

/**
 * BF-40 gave `/api/nutrition/scan` a second reason to receive an image. The regression that would
 * cost most is the quiet one: the photo scan starting to read dinner as a recipe because one
 * per-request line changed underneath it.
 */
describe('scanImageKind — absent means plate', () => {
  it('defaults to plate for every caller that predates BF-40', () => {
    for (const raw of [undefined, null, '', 'photo', 0, {}, ['recipe']]) {
      expect(scanImageKind(raw)).toBe('plate')
    }
  })

  it('only the exact string opts in', () => {
    expect(scanImageKind('recipe')).toBe('recipe')
    // Not a coercion: a typo must fall back to the safe reading, not to the new one.
    expect(scanImageKind('Recipe')).toBe('plate')
    expect(scanImageKind('recipes')).toBe('plate')
  })
})

describe('scanImagePrompt', () => {
  // Pinned verbatim. The point of the default is that an existing caller's request is byte-identical
  // to what it was before BF-40 — "equivalent" is not the claim being made, and only a literal can
  // hold it.
  it('reproduces the pre-BF-40 plate prompt exactly, with no note', () => {
    expect(scanImagePrompt('plate', '')).toBe('Analyse this food photo and return the nutrition JSON.')
  })

  it('reproduces the pre-BF-40 plate prompt exactly, with a note', () => {
    expect(scanImagePrompt('plate', 'it is a large bowl')).toBe(
      'Analyse this food photo. Additional context from user: "it is a large bowl". Return the nutrition JSON.',
    )
  })

  it('tells the model to read a list rather than estimate a plate', () => {
    const p = scanImagePrompt('recipe', '')
    expect(p).toContain('INGREDIENTS')
    expect(p).toMatch(/do not estimate a finished plated portion/i)
    // Never says "photo of food", which is what sends it looking for a plate.
    expect(p).not.toMatch(/analyse this food photo/i)
  })

  it('admits both a written list and the ingredients laid out', () => {
    const p = scanImagePrompt('recipe', '')
    expect(p).toMatch(/written list/i)
    expect(p).toMatch(/laid out/i)
  })

  it('refuses to divide — the yield is the builder\'s question, not the model\'s', () => {
    // A screenshot carries no JSON-LD, so nothing downstream knows the yield. If the model divided
    // on its own the client would divide again at the batch-size field: the documented four-fold
    // calorie error, from the other direction.
    expect(scanImagePrompt('recipe', '')).toMatch(/without dividing it into servings/i)
  })

  it('carries a user note on the recipe path too', () => {
    expect(scanImagePrompt('recipe', 'makes 12')).toContain('Additional context from user: "makes 12".')
  })
})
