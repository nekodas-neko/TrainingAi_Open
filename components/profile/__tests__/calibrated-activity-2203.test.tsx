// @vitest-environment jsdom
/**
 * Issue 2203 — the Calibrated entry of the activity-level picker: the factor the energy model is
 * using (band name WITH its number), the not-enough-data state, and that it never rewrites the
 * stored activity level. The numbers are the payload's; nothing here computes a factor.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'

const h = vi.hoisted(() => ({ data: null as unknown }))
vi.mock('@/app/health/hooks/use-health-calcs', () => ({ useEnergyBalanceToday: () => h.data }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))
vi.mock('@/lib/shell-nav', () => ({ navigateToTab: vi.fn() }))

import { RequiredInfoSection } from '../required-info-section'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const factor = (over: Record<string, unknown>) => ({
  maintenance: { activityFactor: { calibrated: null, measuredMovement: null, gapMessage: null, ...over } },
})

let container: HTMLDivElement
let root: Root | null = null
const onChange = vi.fn()

async function mount() {
  root = createRoot(container)
  await act(async () => {
    root!.render(createElement(RequiredInfoSection, {
      latestWeightKg: 80, latestWeightLabel: null, targetWeightStr: '', onTargetWeightChange: () => {},
      latestBfPct: null, latestBfLabel: null, targetBfStr: '', onTargetBfChange: () => {},
      activityLevel: 'moderate', onActivityLevelChange: onChange, saving: false,
    }))
  })
}
const row = () => container.querySelector('[data-testid="calibrated-activity"]') as HTMLElement | null

beforeEach(() => { container = document.createElement('div'); document.body.appendChild(container); onChange.mockClear() })
afterEach(() => { act(() => root?.unmount()); root = null; container.remove() })

describe('issue 2203 Calibrated activity row', () => {
  it('shows the calibrated factor with its window', async () => {
    h.data = factor({ calibrated: { factor: 1.38, windowDays: 14 } })
    await mount()
    expect(row()?.textContent).toContain('Calibrated · 1.38×')
    expect(row()?.textContent).toContain('last 14 days')
  })

  it('says why when not calibrated, and shows the measured figure instead of a guess', async () => {
    h.data = factor({
      gapMessage: 'Log food on 8 more days to calibrate',
      measuredMovement: { factor: 1.31, windowDays: 7 },
    })
    await mount()
    const t = row()?.textContent ?? ''
    expect(t).toContain('not enough data yet')
    expect(t).toContain('Log food on 8 more days to calibrate')
    expect(t).toContain('1.31× over 7 days')
    expect(t).not.toContain('Calibrated · 1.')
  })

  it('renders nothing before the energy payload arrives', async () => {
    h.data = null
    await mount()
    expect(row()).toBeNull()
  })

  it('keeps all five manual bands and does not change the stored level', async () => {
    h.data = factor({ calibrated: { factor: 1.38, windowDays: 14 } })
    await mount()
    expect(container.querySelectorAll('[role="radio"]').length).toBe(5)
    await act(async () => { row()!.click() })
    expect(onChange).not.toHaveBeenCalled()
  })
})
