import { describe, it, expect } from 'vitest'
import { movementBalance, PATTERN_ORDER } from '../movement-balance'

/**
 * OR-118's grouping. The card's whole claim is the RATIO between these four numbers, so the cases
 * worth pinning are the ones that would move it silently.
 */
describe('movementBalance', () => {
  it('reproduces the finding the entry was filed on', () => {
    // The production shape, collapsed to one muscle per pattern — the entry's measured split is
    // legs 481 · push 433 · pull 333 · other 168 over 60 days.
    const { rows, total } = movementBalance([
      { muscle: 'quads', sets: 481 },
      { muscle: 'chest', sets: 433 },
      { muscle: 'back', sets: 333 },
      { muscle: 'abs', sets: 168 },
    ])
    expect(total).toBe(1415)
    const pct = Object.fromEntries(rows.map(r => [r.pattern, Math.round(r.pct)]))
    expect(pct).toEqual({ legs: 34, push: 31, pull: 24, other: 12 })
  })

  it('counts shoulders as push, which is the call a reader is most likely to re-derive wrongly', () => {
    const { rows } = movementBalance([{ muscle: 'shoulders', sets: 10 }])
    const byPattern = Object.fromEntries(rows.map(r => [r.pattern, r.sets]))
    expect(byPattern.push).toBe(10)
    expect(byPattern.pull).toBe(0)
  })

  it('counts lower back as other, NOT legs — counting it as legs inflates legs on pull days', () => {
    const { rows } = movementBalance([{ muscle: 'lower back', sets: 8 }])
    const byPattern = Object.fromEntries(rows.map(r => [r.pattern, r.sets]))
    expect(byPattern.other).toBe(8)
    expect(byPattern.legs).toBe(0)
  })

  it('keeps a zero row rather than dropping it — an empty pull column IS the finding', () => {
    const { rows } = movementBalance([{ muscle: 'chest', sets: 20 }])
    expect(rows.map(r => r.pattern)).toEqual(PATTERN_ORDER)
    expect(rows.find(r => r.pattern === 'pull')).toEqual({ pattern: 'pull', sets: 0, pct: 0 })
  })

  it('holds the display order fixed, so push and pull do not swap places between visits', () => {
    const { rows } = movementBalance([
      { muscle: 'back', sets: 99 },
      { muscle: 'chest', sets: 1 },
    ])
    expect(rows.map(r => r.pattern)).toEqual(['push', 'pull', 'legs', 'other'])
  })

  it('sums several muscles into one pattern, weighted sets included', () => {
    // The route already halves secondary muscles, so a fractional count is the normal case here.
    const { rows } = movementBalance([
      { muscle: 'chest', sets: 12 },
      { muscle: 'triceps', sets: 6.5 },
      { muscle: 'shoulders', sets: 4 },
    ])
    expect(rows.find(r => r.pattern === 'push')?.sets).toBe(22.5)
  })

  it('folds a synonym through normalizeMuscle rather than dropping it into other', () => {
    const { rows } = movementBalance([{ muscle: 'pecs', sets: 5 }])
    const byPattern = Object.fromEntries(rows.map(r => [r.pattern, r.sets]))
    expect(byPattern.push).toBe(5)
    expect(byPattern.other).toBe(0)
  })

  it('an unmapped name lands in other instead of throwing', () => {
    const { rows, total } = movementBalance([{ muscle: 'not-a-muscle', sets: 3 }])
    expect(total).toBe(3)
    expect(rows.find(r => r.pattern === 'other')?.sets).toBe(3)
  })

  it('ignores a non-finite or negative count instead of poisoning every percentage', () => {
    const { rows, total } = movementBalance([
      { muscle: 'chest', sets: 10 },
      { muscle: 'back', sets: Number.NaN },
      { muscle: 'quads', sets: -5 },
    ])
    expect(total).toBe(10)
    expect(rows.find(r => r.pattern === 'push')?.pct).toBe(100)
  })

  it('reports zero percentages rather than NaN when nothing was logged', () => {
    const { rows, total } = movementBalance([])
    expect(total).toBe(0)
    expect(rows.every(r => r.sets === 0 && r.pct === 0)).toBe(true)
  })

  it('percentages sum to 100 across the four rows', () => {
    const { rows } = movementBalance([
      { muscle: 'chest', sets: 7 },
      { muscle: 'lats', sets: 11 },
      { muscle: 'glutes', sets: 13 },
      { muscle: 'obliques', sets: 3 },
    ])
    expect(rows.reduce((s, r) => s + r.pct, 0)).toBeCloseTo(100, 10)
  })
})
