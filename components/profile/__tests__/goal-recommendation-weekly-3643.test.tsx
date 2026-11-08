// @vitest-environment jsdom
/**
 * #3643 — applying a recommendation in weekly mode stored 7× the daily steps and water goals.
 * `stepsGoal` / `waterGoalMl` are daily in both modes, so the PATCH carries the recommended daily
 * figure unchanged; only the label reads ×7.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('@/lib/cache-groups', () => ({ invalidateGoalRecommendations: vi.fn(async () => {}) }))

import { GoalRecommendationSheet, type GoalRecommendationData } from '../goal-recommendation-sheet'
import { goalShownForPeriod, recommendationGoalsPatch } from '@trainingai/shared/nutrition/goal-recommendation-apply'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const data: GoalRecommendationData = {
  id: 'rec-1',
  current: {
    stepsGoal: 8000, stepsGoalType: 'weekly', waterGoalMl: 2500, waterGoalType: 'weekly',
    proteinG: 150, carbsG: 250, fatG: 70, activityLevel: 'moderate',
  },
  recommended: {
    stepsGoal: 10000, calories: 2600, proteinG: 160, carbsG: 260, fatG: 75, waterMl: 3000,
    activityLevel: 'moderate',
  },
  reasoning: 'r', insights: '', dataQualityNote: '',
}

let container: HTMLDivElement
let root: Root | null = null
const calls: { url: string; method: string; body: unknown }[] = []

beforeEach(() => {
  calls.length = 0
  container = document.createElement('div')
  document.body.appendChild(container)
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, method: String(init.method), body: JSON.parse(String(init.body)) })
    return new Response('{}', { status: 200 })
  }))
})
afterEach(() => {
  act(() => root?.unmount())
  root = null
  container.remove()
  vi.unstubAllGlobals()
  localStorage.clear()
})

describe('goal recommendation in weekly mode (#3643)', () => {
  it('stores the daily figures, and shows both sides ×7', async () => {
    const onGoalsApplied = vi.fn()
    root = createRoot(container)
    await act(async () => {
      root!.render(createElement(GoalRecommendationSheet, {
        open: true, onOpenChange: () => {}, data, onUserSaved: () => {}, onGoalsApplied,
      }))
    })
    const text = document.body.textContent ?? ''
    expect(text).toContain('56,000 → 70,000')
    expect(text).toContain('17,500ml → 21,000ml')

    const apply = [...document.body.querySelectorAll('button')].find(b => b.textContent === 'Apply Selected')!
    await act(async () => { apply.click() })

    const goals = calls.find(c => c.url === '/api/user/goals')
    expect(goals?.body).toEqual({ stepsGoal: 10000, waterGoalMl: 3000 })
    expect(onGoalsApplied).toHaveBeenCalledWith({ stepsGoal: 10000, waterGoalMl: 3000 })
  })
})

describe('the shared helpers', () => {
  it('shows a stored daily goal in its mode', () => {
    expect(goalShownForPeriod(10000, 'weekly')).toBe(70000)
    expect(goalShownForPeriod(10000, 'daily')).toBe(10000)
    expect(goalShownForPeriod(10000, null)).toBe(10000)
  })
  it('patches only the ticked rows, with the daily figure', () => {
    expect(recommendationGoalsPatch({ stepsGoal: 9999.6, waterMl: 2800 }, { steps: true, water: false }))
      .toEqual({ stepsGoal: 10000 })
    expect(recommendationGoalsPatch({ stepsGoal: 9000, waterMl: 2800.4 }, { steps: false, water: true }))
      .toEqual({ waterGoalMl: 2800 })
  })
})
