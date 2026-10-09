// @vitest-environment jsdom
/**
 * issue 2154 — saved-meal rows show which meals a meal can be used for, read from `mealTypeIds`.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { SavedMealCard } from '../saved-meal-card'
import { mealTypeIcon, taggedMealTypes } from '../meal-type-icons'
import type { MealType, SavedMeal } from '@trainingai/shared/types/nutrition'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const mt = (id: string, name: string, sortOrder: number): MealType => ({
  id, userId: 'u', name, emoji: '', sortOrder, timeStartHour: 0, timeEndHour: 24,
  remindersEnabled: false, required: false, createdAt: new Date(0),
})
const TYPES = [
  mt('d', 'Dinner', 5), mt('b', 'Pre Workout (Breakfast)', 0), mt('p', 'Post Workout', 1), mt('l', 'Lunch', 2),
  mt('x', 'Midnight Feast', 6),
]
const meal = (mealTypeIds: string[]): SavedMeal => ({
  id: 'm1', name: 'Protein shake', servings: 1, mealTypeIds, items: [],
  totals: { calories: 200, proteinG: 30, carbsG: 5, fatG: 3 },
} as unknown as SavedMeal)

let root: Root | null = null
let host: HTMLElement | null = null
function render(ids: string[], types: MealType[] = TYPES) {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  const noop = () => {}
  act(() => {
    root!.render(createElement(SavedMealCard, {
      meal: meal(ids), selected: null, onToggleSelected: noop, onOpen: noop, onEdit: noop,
      onRequestDelete: noop, onLabel: noop, mealTypes: types,
    }))
  })
  return host
}
afterEach(() => { act(() => root?.unmount()); host?.remove(); root = null; host = null })

const tag = (h: HTMLElement) => h.querySelector('[aria-label^="Good for"]')

describe('issue 2154 meal-type icons on a saved-meal row', () => {
  it('shows nothing for an untagged meal (untagged means any meal)', () => {
    expect(tag(render([]))).toBeNull()
  })

  it('one tag: one icon, named', () => {
    const el = tag(render(['l']))!
    expect(el.getAttribute('aria-label')).toBe('Good for Lunch')
    expect(el.getAttribute('title')).toBe('Good for Lunch')
    expect(el.querySelectorAll('svg')).toHaveLength(1)
  })

  it('all four: four icons in meal order, no overflow badge, icons hidden from AT', () => {
    const el = tag(render(['d', 'l', 'p', 'b']))!
    expect(el.getAttribute('aria-label')).toBe('Good for Pre Workout (Breakfast), Post Workout, Lunch, Dinner')
    const svgs = el.querySelectorAll('svg')
    expect(svgs).toHaveLength(4)
    svgs.forEach(s => expect(s.getAttribute('aria-hidden')).toBe('true'))
    expect(el.textContent).toBe('')
  })

  it('more than four: first four plus +N, and all names stay in the label', () => {
    const el = tag(render(['d', 'l', 'p', 'b', 'x']))!
    expect(el.querySelectorAll('svg')).toHaveLength(4)
    expect(el.textContent).toBe('+1')
    expect(el.getAttribute('aria-label')).toContain('Midnight Feast')
  })

  it('ignores ids that are not a live meal type', () => {
    expect(tag(render(['gone']))).toBeNull()
    expect(taggedMealTypes(TYPES, ['gone', 'l']).map(t => t.id)).toEqual(['l'])
  })

  it('keeps the row from overflowing: flex-none glyphs inside the min-w-0 text column', () => {
    const el = tag(render(['d', 'l', 'p', 'b']))!
    expect(el.closest('.min-w-0')).not.toBeNull()
    el.querySelectorAll('svg').forEach(s => expect(s.getAttribute('class')).toContain('flex-none'))
  })

  it('an unmapped custom name gets the generic fallback, never nothing', () => {
    expect(mealTypeIcon('Midnight Feast')).toBe(mealTypeIcon('???'))
    expect(mealTypeIcon('Dinner')).not.toBe(mealTypeIcon('???'))
    expect(mealTypeIcon('Pre Workout (Breakfast)')).not.toBe(mealTypeIcon('Post Workout'))
  })
})
