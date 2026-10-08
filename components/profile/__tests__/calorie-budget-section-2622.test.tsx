// @vitest-environment jsdom
/**
 * Issue 2622 — the Goals screen's calorie budget line, in each state of the approved mockup:
 * default (read-only, with its breakdown), own target set, validation error, and clear.
 *
 * The numbers are the payload's, read through `budgetProvenance`; nothing here computes calories.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { budgetProvenance } from '@trainingai/shared/nutrition/calorie-balance'

const h = vi.hoisted(() => ({ data: null as unknown }))
vi.mock('@/app/health/hooks/use-health-calcs', () => ({ useEnergyBalanceToday: () => h.data }))

import { CalorieBudgetSection } from '../calorie-budget-section'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// The example on the issue: RMR 1,304, recomp deficit 232, movement 237, everyday burn 261.
function payload(ownTargetKcal: number | null) {
  const balance = {
    intakeKcal: 910, restingBaseKcal: 1200, activeKcal: 237, targetNetKcal: -232,
    restingRateKcal: 1304, deficitKcal: 232, stepCreditKcal: 0, ownTargetKcal,
    remainingKcal: 0, zoneColor: 'green',
  }
  return { goal: 'recomp', balance }
}

let container: HTMLDivElement
let root: Root | null = null

async function mount(props: Partial<Parameters<typeof CalorieBudgetSection>[0]> = {}) {
  root = createRoot(container)
  await act(async () => {
    root!.render(createElement(CalorieBudgetSection, {
      ownTargetKcal: null,
      onSetOwnTarget: async () => null,
      onClearOwnTarget: async () => null,
      ...props,
    }))
  })
}
const text = () => container.textContent ?? ''
const button = (name: string) =>
  [...container.querySelectorAll('button')].find(b => b.textContent?.includes(name)) as HTMLButtonElement | undefined

async function type(value: string) {
  const input = container.querySelector('input') as HTMLInputElement
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    setter.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  h.data = payload(null)
})
afterEach(async () => {
  await act(async () => { root?.unmount() })
  root = null
  container.remove()
})

describe('default: the worked-out budget, read-only', () => {
  it('shows the budget, where it comes from and the terms that add up to it', async () => {
    await mount()
    const total = budgetProvenance(payload(null).balance as never).total
    expect(text()).toContain('Calorie budget today')
    expect(text()).toContain(total.toLocaleString())
    expect(text()).toContain('worked out, not typed')
    for (const row of ['Resting rate', 'Recomp deficit (0.3% a week)', 'Everyday burn (20%)', 'Movement today', 'Budget']) {
      expect(text()).toContain(row)
    }
    expect(text()).toContain('−232')
    expect(container.querySelector('input')).toBeNull()
    expect(text()).toContain('Set my own target instead')
  })

  it('has no Daily/Weekly switch, no typed-goal box and no "Recommended" line', async () => {
    await mount()
    expect(text()).not.toMatch(/Daily|Weekly|Recommended/)
    expect(container.querySelector('#goals-calorieGoal')).toBeNull()
  })
})

describe('setting an own target', () => {
  it('opens a number field, saves a valid number, and reports it to the caller', async () => {
    const onSet = vi.fn(async () => null)
    await mount({ onSetOwnTarget: onSet })
    await act(async () => { button('Set my own target instead')!.click() })
    await type('1800')
    await act(async () => { button('Save')!.click() })
    expect(onSet).toHaveBeenCalledWith(1800)
  })

  it.each([['500', /at least 800/], ['20000', /10,000 kcal or less/], ['', /Enter your daily target/]])(
    'shows an inline error for %j and does not save', async (value, message) => {
      const onSet = vi.fn(async () => null)
      await mount({ onSetOwnTarget: onSet })
      await act(async () => { button('Set my own target instead')!.click() })
      await type(value)
      await act(async () => { button('Save')!.click() })
      expect(onSet).not.toHaveBeenCalled()
      expect(container.querySelector('[role="alert"]')?.textContent).toMatch(message)
    })

  it("shows a refused save under the field", async () => {
    await mount({ onSetOwnTarget: async () => "Couldn't save. Check your connection and try again." })
    await act(async () => { button('Set my own target instead')!.click() })
    await type('1800')
    await act(async () => { button('Save')!.click() })
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Couldn't save")
  })
})

describe('with an own target set', () => {
  beforeEach(() => { h.data = payload(1800) })

  it('labels it, shows what the worked-out budget would be, and drops the breakdown', async () => {
    await mount({ ownTargetKcal: 1800 })
    const worked = budgetProvenance(payload(1800).balance as never).workedOutTotal
    expect(text()).toContain('your own target')
    expect(text()).toContain('1,800')
    expect(text()).toContain(`Worked-out budget today would be ${worked.toLocaleString()}`)
    expect(text()).toContain('replaces it everywhere')
    expect(text()).not.toContain('Everyday burn')
    expect((container.querySelector('input') as HTMLInputElement).value).toBe('1800')
  })

  it('"Use the worked-out budget" clears it', async () => {
    const onClear = vi.fn(async () => null)
    await mount({ ownTargetKcal: 1800, onClearOwnTarget: onClear })
    await act(async () => { button('Use the worked-out budget')!.click() })
    expect(onClear).toHaveBeenCalledTimes(1)
  })

  it('sits below the worked-out budget without being floored or hidden', async () => {
    h.data = payload(900)
    await mount({ ownTargetKcal: 900 })
    expect(text()).toContain('900')
    expect(text()).toContain('would be')
  })
})
