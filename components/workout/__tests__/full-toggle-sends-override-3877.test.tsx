// @vitest-environment jsdom
/**
 * #3877(a), review of acd5f2d. The web sent `wasOverride` only from `?wasOverride=1`, which Session
 * Select sets only when readiness recommends a deload or rest. On a planned deload week with normal
 * readiness the lifter opens `/workout?session=X` and taps Full: the log carried neither
 * `intensityMode` nor `wasOverride`, so the server stored the session as a deload (1RM 0, no record).
 *
 * Driven from the toggle's own hook, so the payload fields are the ones the screen builds.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'

vi.mock('@/lib/sqlite/cache', () => ({ readTodayCacheSync: () => null }))

import { useDeloadChoice } from '../use-deload-choice'
import { sessionIntensityForLog } from '../utils'
import type { SessionPeriodization } from '@trainingai/shared/types/ai-periodization'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// A planned deload week: the type is in its deload phase and the plan is the deload.
const plannedDeload = {
  phase: 'deload', sessionsInPhase: 1,
  prescriptionStatus: 'auto_applied',
  prescriptionExpiresAt: new Date(Date.now() + 5 * 86_400_000).toISOString(),
  prescription: { phase: 'deload', phaseAction: 'stay', deload: true, exercises: [{ name: 'Squat', deloaded: false }] },
} as unknown as SessionPeriodization

let latest: ReturnType<typeof useDeloadChoice>
function Harness({ p, seed }: { p: SessionPeriodization; seed: boolean }) {
  latest = useDeloadChoice(seed, p)
  return null
}
let root: Root | null = null
const mount = async (p: SessionPeriodization, seed = false) => {
  root = createRoot(document.createElement('div'))
  await act(async () => { root!.render(createElement(Harness, { p, seed })) })
}
afterEach(async () => { await act(async () => { root?.unmount() }); root = null })

/** The fields `workout-screen.tsx` puts on the log, from the toggle's state as it stands. */
const logFields = (urlOverride = false) => sessionIntensityForLog({
  deload: latest.deload, urlOverride, overrideFull: latest.overrideFull,
  // `aiDynamicFallbackPhaseStatus` marks the deload phase active.
  phaseDeloadActive: true, isAiDynamic: true,
})

describe('the Full toggle reaches the log payload', () => {
  it('no URL param, the lifter taps Full over a planned deload: the log says it was overridden', async () => {
    await mount(plannedDeload)
    expect(latest.deload).toBe(true) // adopted from the plan
    expect(logFields().fields).toEqual({ intensityMode: 'deload' })

    await act(async () => { latest.setDeload(false) })
    expect(latest.overrideFull).toBe(true)
    const { fields, isAnyDeload } = logFields()
    expect(fields).toEqual({ wasOverride: true })
    // The screen's own estimate and optimistic record agree with the server's: not a deload.
    expect(isAnyDeload).toBe(false)
  })

  it('Full, then back to Deload: a deload, with no override', async () => {
    await mount(plannedDeload)
    await act(async () => { latest.setDeload(false) })
    await act(async () => { latest.setDeload(true) })
    expect(logFields()).toEqual({ fields: { intensityMode: 'deload' }, isAnyDeload: true })
  })

  it('the URL param still counts, as before', async () => {
    await mount(plannedDeload, false)
    expect(logFields(true).fields).toMatchObject({ wasOverride: true })
  })

  it('a static program\'s deload phase still counts toward the estimate under an override', () => {
    expect(sessionIntensityForLog({ deload: false, urlOverride: true, overrideFull: false, phaseDeloadActive: true, isAiDynamic: false }))
      .toEqual({ fields: { wasOverride: true }, isAnyDeload: true })
  })
})
