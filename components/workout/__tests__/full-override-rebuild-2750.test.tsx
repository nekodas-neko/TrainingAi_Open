// @vitest-environment jsdom
/**
 * Issue 2750. Tapping Full over a stored deload that recorded no full numbers left the deload on
 * the bar and said so ("these weights are unchanged"), with changing the time preset as the
 * unmentioned way out, because that rebuild writes the numbers Full reverts to. Full now does that
 * rebuild itself, once per choice.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'

const toastError = vi.fn()
vi.mock('sonner', () => ({ toast: { error: (...a: unknown[]) => toastError(...a) } }))
vi.mock('@/lib/cache-groups', () => ({ invalidatePrescriptionChanged: async () => {} }))
vi.mock('@/components/workout/warmup-screen', () => ({ WARMUP_GOAL_SEC_FALLBACK: 600 }))

import { useDurationPreset } from '../use-duration-preset'
import { fullOverrideNeedsRebuild, type DeloadOverrideOutcome } from '../utils'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

type Props = Partial<Parameters<typeof useDurationPreset>[0]>
const fetchExercises = vi.fn()
const loadPeriodization = vi.fn()
const fetchMock = vi.fn()

function Harness(props: Props) {
  useDurationPreset({
    programSessionId: 'ps-1', sessionBudgetMin: 60, durationPreset: 'quick',
    fetchExercises, loadPeriodization, ...props,
  })
  return null
}

let root: Root | null = null
let host: HTMLDivElement | null = null
const mount = async (props: Props) => {
  host = document.createElement('div')
  root = createRoot(host)
  await act(async () => { root!.render(createElement(Harness, props)) })
}
const rerender = (props: Props) => act(async () => { root!.render(createElement(Harness, props)) })
const calls = () => fetchMock.mock.calls.map(c => ({ url: c[0] as string, body: JSON.parse((c[1] as { body: string }).body) }))

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockReset().mockResolvedValue({ ok: true, status: 200 })
  toastError.mockReset(); fetchExercises.mockReset(); loadPeriodization.mockReset()
})
afterEach(async () => {
  await act(async () => { root?.unmount() })
  root = null; host = null
  vi.unstubAllGlobals()
})

describe('Full over a deload with nothing to revert rebuilds the prescription', () => {
  it('rebuilds once, at the preset already in use, then reloads what the screen shows', async () => {
    await mount({ overrideFull: true, fullNeedsRebuild: true })
    expect(calls()).toEqual([{ url: '/api/ai-periodization/session/ps-1/prescribe', body: { durationPreset: 'quick' } }])
    expect(fetchExercises).toHaveBeenCalledTimes(1)
    expect(loadPeriodization).toHaveBeenCalledWith({ afterWrite: true })
  })

  it('uses the standard preset when the prescription carries none', async () => {
    await mount({ overrideFull: true, fullNeedsRebuild: true, durationPreset: undefined })
    expect(calls()[0].body).toEqual({ durationPreset: 'standard' })
  })

  it('does nothing when Full is not chosen, or when there is something to revert', async () => {
    await mount({ overrideFull: false, fullNeedsRebuild: true })
    await rerender({ overrideFull: true, fullNeedsRebuild: false })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('does nothing without a session to rebuild', async () => {
    await mount({ overrideFull: true, fullNeedsRebuild: true, programSessionId: undefined })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('does not loop when the rebuild still leaves an exercise unable to revert', async () => {
    // An exercise with no progression style gets no full numbers however often the plan is rebuilt.
    await mount({ overrideFull: true, fullNeedsRebuild: true })
    await rerender({ overrideFull: true, fullNeedsRebuild: true, durationPreset: 'quick' })
    await rerender({ overrideFull: true, fullNeedsRebuild: true, durationPreset: 'standard' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('treats dropping Full and choosing it again as a new choice', async () => {
    await mount({ overrideFull: true, fullNeedsRebuild: true })
    await rerender({ overrideFull: false, fullNeedsRebuild: false })
    await rerender({ overrideFull: true, fullNeedsRebuild: true })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('says it was Full that failed, and does not hammer a rate-limited route', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 429 })
    await mount({ overrideFull: true, fullNeedsRebuild: true })
    await rerender({ overrideFull: true, fullNeedsRebuild: true })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(toastError).toHaveBeenCalledWith('Too many plan rebuilds this hour — try again shortly')
    expect(fetchExercises).not.toHaveBeenCalled()
  })

  it('names Full in the message when the request itself fails', async () => {
    fetchMock.mockRejectedValue(new Error('offline'))
    await mount({ overrideFull: true, fullNeedsRebuild: true })
    expect(toastError).toHaveBeenCalledWith("Couldn't rebuild for Full — try again")
  })
})

describe('fullOverrideNeedsRebuild', () => {
  const outcomes: DeloadOverrideOutcome[] = ['none', 'all', 'partial', 'nothing-to-revert', 'all-in-deload-week', 'partial-in-deload-week']

  it('is true when a deloaded exercise could not revert, whatever the outcome', () => {
    for (const o of outcomes) expect(fullOverrideNeedsRebuild(o, ['Dumbbell Fly'], false), o).toBe(true)
  })

  it('is true when the override reverted nothing at all outside a deload week', () => {
    expect(fullOverrideNeedsRebuild('nothing-to-revert', [], false)).toBe(true)
  })

  it('is false when every exercise reverted, or there was nothing to override', () => {
    for (const o of ['none', 'all', 'all-in-deload-week'] as const) expect(fullOverrideNeedsRebuild(o, [], false), o).toBe(false)
  })

  it('is false in a deload week with nothing cut: a rebuild would change nothing', () => {
    expect(fullOverrideNeedsRebuild('nothing-to-revert', [], true)).toBe(false)
  })
})
