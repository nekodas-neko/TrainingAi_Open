import { describe, it, expect } from 'vitest'
import { reductionNeeded, applyReduction, type Pin } from '../meal-count-reduction'

const pin = (key: string, kind: Pin['kind'] = 'saved'): Pin => ({ key, name: key, kind })

describe('reductionNeeded — the threshold is the picker\'s, not the server\'s', () => {
  it('says nothing when the pins still fit with a slot to spare', () => {
    // 2 pins into 3 meals leaves one open slot, which is exactly what the picker allows.
    expect(reductionNeeded([pin('a'), pin('b')], 3)).toBeNull()
  })

  it('fires at K = M, which the SERVER would have accepted', () => {
    // The server caps at `kept.slice(mealCount)`, so three pins into three meals passes there and
    // produces a plan with nothing for the planner to do. The picker's rule is the stricter one.
    const d = reductionNeeded([pin('a'), pin('b'), pin('c')], 3)
    expect(d).not.toBeNull()
    expect(d!.maxKeepable).toBe(2)
    expect(d!.overflow.map(p => p.key)).toEqual(['c'])
  })

  it('names every pin that no longer fits, not just the first', () => {
    const d = reductionNeeded([pin('a'), pin('b'), pin('c'), pin('d')], 2)
    expect(d!.maxKeepable).toBe(1)
    expect(d!.overflow.map(p => p.key)).toEqual(['b', 'c', 'd'])
  })

  it('pre-ticks the first M-1 in pick order, so the safe path is one tap', () => {
    const d = reductionNeeded([pin('a'), pin('b'), pin('c')], 3)
    expect(d!.preselected).toEqual(['a', 'b'])
  })

  it('handles one meal a day, where nothing may be pinned at all', () => {
    const d = reductionNeeded([pin('a')], 1)
    expect(d!.maxKeepable).toBe(0)
    expect(d!.preselected).toEqual([])
    expect(d!.overflow.map(p => p.key)).toEqual(['a'])
  })

  it('says nothing when there are no pins, whatever the count', () => {
    expect(reductionNeeded([], 1)).toBeNull()
  })
})

describe('applyReduction — a dropped typed meal stays as a steer', () => {
  const typed = [
    { text: 'chicken and rice', keep: true },
    { text: 'oats', keep: true },
    { text: 'a snack', keep: false },
  ]

  it('drops the saved ids the user did not keep', () => {
    const out = applyReduction(['m1'], ['m1', 'm2'], typed)
    expect(out.selectedIds).toEqual(['m1'])
  })

  it('unticks a dropped typed meal rather than deleting it', () => {
    // Deleting would throw away text the user typed, to answer a question nobody asked them.
    const out = applyReduction(['chicken and rice'], [], typed)
    expect(out.typedMeals.map(m => [m.text, m.keep])).toEqual([
      ['chicken and rice', true],
      ['oats', false],
      ['a snack', false],
    ])
  })

  it('leaves an already-unticked steer alone', () => {
    const out = applyReduction([], [], typed)
    expect(out.typedMeals[2]).toBe(typed[2])
  })
})
