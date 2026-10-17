// @vitest-environment jsdom
/**
 * Issue 2960. The ring (`useEstimatedMeals`) and the Active Plan card (`planCardEatenKcal` over
 * `useCountedEstimateRows`) read one set of rows, so they agree before and after the local read lands.
 */
import { describe, it, expect, afterEach, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { FoodLogWithItem, MealType } from '@trainingai/shared/types/nutrition'
import { planCardEatenKcal } from '@/components/nutrition/plan-card-kcal'

const h = vi.hoisted(() => ({ store: null as unknown }))
vi.mock('@/lib/local-store', () => ({ getLocalStore: () => h.store }))

import { useEstimatedMeals, useCountedEstimateRows, notifyPlanMealAnswersChanged } from '../use-estimated-meals'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const LUNCH = 'mt-l'
const DINNER = 'mt-d'
const mealTypes = [
  { id: LUNCH, name: 'Lunch', startHour: 11, endHour: 14 },
  { id: DINNER, name: 'Dinner', startHour: 17, endHour: 21 },
] as unknown as MealType[]
const dinnerLog = { mealTypeId: DINNER } as unknown as FoodLogWithItem

function makeStore(answerKcal: number) {
  return {
    getPlanMealAnswers: async () => [{ planMealId: 'pm-d', answer: 'estimated', estCalories: answerKcal, deletedAt: null }],
    getActiveMealPlan: async () => ({ variants: [{ meals: [{ id: 'pm-d', mealTypeId: DINNER, suggestedTime: '18:30' }] }] }),
    getMealTypes: async () => (mealTypes as unknown as { id: string; name: string; startHour: number; endHour: number }[]).map(t => ({ id: t.id, name: t.name, startHour: t.startHour, endHour: t.endHour })),
  }
}

let root: Root | null = null
let host: HTMLDivElement | null = null
afterEach(() => { act(() => root?.unmount()); host?.remove(); root = null; host = null; h.store = null })

function mount(props: { serverRows: unknown; logs: FoodLogWithItem[] }) {
  const out: { ring?: ReturnType<typeof useEstimatedMeals>; card?: number | undefined } = {}
  function Probe() {
    const ring = useEstimatedMeals({ userId: 'u1', date: '2026-10-17', mealTypes, logs: props.logs, serverRows: props.serverRows })
    const rows = useCountedEstimateRows({ userId: 'u1', date: '2026-10-17', serverRows: props.serverRows })
    out.ring = ring
    out.card = planCardEatenKcal({ loggedKcal: 600, estimates: rows, loggedMealTypeIds: props.logs.map(l => l.mealTypeId) })
    return null
  }
  host = document.createElement('div')
  root = createRoot(host)
  act(() => root!.render(createElement(Probe)))
  return out
}
const flush = () => act(async () => { await new Promise(r => setTimeout(r, 0)) })

describe('one estimate for the ring and the plan card (issue 2960)', () => {
  it('agrees before the local read lands, on the server rows, not 0', () => {
    h.store = makeStore(650)
    const out = mount({ serverRows: [{ mealTypeId: DINNER, kcal: 650 }], logs: [] })
    expect(out.ring!.kcal).toBe(650)
    expect(out.ring!.meals).toBe('dinner')
    expect(out.card).toBe(600 + out.ring!.kcal)
  })

  it('agrees after the local read lands, and follows a changed answer', async () => {
    h.store = makeStore(500)
    const out = mount({ serverRows: [{ mealTypeId: DINNER, kcal: 650 }], logs: [] })
    await flush()
    expect(out.ring!.kcal).toBe(500)
    expect(out.card).toBe(1100)
    h.store = null
    h.store = makeStore(700)
    act(() => notifyPlanMealAnswersChanged())
    await flush()
    expect(out.ring!.kcal).toBe(700)
    expect(out.card).toBe(1300)
  })

  it('drops a superseded estimate from both, before and after the local read', async () => {
    h.store = makeStore(650)
    const out = mount({ serverRows: [{ mealTypeId: DINNER, kcal: 650 }], logs: [dinnerLog] })
    expect(out.ring!.kcal).toBe(0)
    expect(out.ring!.meals).toBeNull()
    expect(out.card).toBe(600)
    await flush()
    expect(out.ring!.kcal).toBe(0)
    expect(out.card).toBe(600)
  })

  it('reads the server rows with no local store', () => {
    const out = mount({ serverRows: [{ mealTypeId: LUNCH, kcal: 480 }], logs: [] })
    expect(out.ring!.kcal).toBe(480)
    expect(out.card).toBe(1080)
  })
})
