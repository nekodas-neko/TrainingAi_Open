// @vitest-environment jsdom
/**
 * issue 2925. The end-of-day card printed `totals.calories` (logged food only) beside a budget the ring
 * had already counted estimates against: 600 on the card, 1,250 on the ring, and 650 kcal too much
 * "left". It now takes the shared `countedIntakeKcal`, stripes the estimated share like the other
 * bars, and the sheet feeds it the estimates local-first (`useCountedEstimateRows`).
 */
import { describe, it, expect, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { stripComments } from '../../../../scripts/lib/strip-comments.js'
import { DaySummaryCard } from '../day-summary-card'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | null = null
let host: HTMLDivElement | null = null
function render(el: ReturnType<typeof createElement>) {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => root!.render(el))
  return host
}
afterEach(() => { act(() => root?.unmount()); host?.remove(); root = null; host = null })

const TOTALS = { calories: 600, proteinG: 50, carbsG: 60, fatG: 20 }
const DINNER = [{ mealTypeId: 'dinner', kcal: 650 }]
const card = (over: Partial<Parameters<typeof DaySummaryCard>[0]> = {}) => createElement(DaySummaryCard, {
  totals: TOTALS, estimates: DINNER, loggedMealTypeIds: ['breakfast', 'lunch'],
  targets: null, dayBudgetKcal: 2000, battery: null, ...over,
})

describe('the end-of-day card counts the estimate (issue 2925)', () => {
  it("prints the ring's 1,250, not the logged 600, and the remainder from it", () => {
    const el = render(card())
    expect(el.textContent).toContain('1250 / 2000 kcal')
    expect(el.textContent).toContain('750 left')
    expect(el.textContent).not.toContain('1400 left')
  })

  it('stripes the estimated share and names it', () => {
    const el = render(card())
    const stripe = el.querySelector<HTMLElement>('[data-estimated-stripe]')!
    expect(stripe).not.toBeNull()
    expect(parseFloat(stripe.style.left)).toBeCloseTo(30, 1)    // 600 / 2000
    expect(parseFloat(stripe.style.width)).toBeCloseTo(32.5, 1) // 650 / 2000
    expect(el.textContent).toContain('incl. 650 estimated')
  })

  it('drops an estimate whose meal now has food logged, and draws no stripe', () => {
    const el = render(card({ totals: { ...TOTALS, calories: 1300 }, loggedMealTypeIds: ['breakfast', 'lunch', 'dinner'] }))
    expect(el.textContent).toContain('1300 / 2000 kcal')
    expect(el.querySelector('[data-estimated-stripe]')).toBeNull()
    expect(el.textContent).not.toContain('estimated')
  })

  it('is unchanged on a day with no estimate', () => {
    const el = render(card({ estimates: [] }))
    expect(el.textContent).toContain('600 / 2000 kcal')
    expect(el.textContent).toContain('1400 left')
  })
})

describe('the sheet reads the estimates the way the ring does (issue 2925)', () => {
  const read = (rel: string) => stripComments(readFileSync(path.resolve(__dirname, '../../../..', rel), 'utf8'))
  it('EndOfDayReview uses useCountedEstimateRows and hands the rows to the card', () => {
    const src = read('components/nutrition/end-of-day/end-of-day-review.tsx')
    expect(src).toMatch(/useCountedEstimateRows\(/)
    expect(src).toMatch(/<DaySummaryCard[^>]*estimates=\{estimates\}/)
  })
  it('the page passes the payload\'s per-meal estimates as the stand-in rows', () => {
    expect(read('app/nutrition/nutrition-content.tsx')).toMatch(/serverEstimateRows=\{balanceForDate\?\.balance\?\.estimatedMeals\}/)
  })
})
