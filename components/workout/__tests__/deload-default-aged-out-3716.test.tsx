// @vitest-environment jsdom
/**
 * #3716. The Deload toggle adopted `prescription.deload` from any prescription that was not
 * `consumed`, expired or not. #3712 ends an illness deload at midnight, so the next morning the
 * toggle still pre-selected Deload and the lifter trained yesterday's sick report.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'

vi.mock('@/lib/sqlite/cache', () => ({ readTodayCacheSync: () => null }))

import { useDeloadChoice } from '../use-deload-choice'
import type { SessionPeriodization } from '@trainingai/shared/types/ai-periodization'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const illnessDeload = (expiresAt: string | null, over: Record<string, unknown> = {}) => ({
  prescriptionStatus: 'pending',
  prescriptionExpiresAt: expiresAt,
  prescription: { phaseAction: 'deload_recommended', deload: true, exercises: [{ name: 'Squat', deloaded: true }] },
  ...over,
}) as unknown as SessionPeriodization

let latest: ReturnType<typeof useDeloadChoice>
function Harness({ p }: { p: SessionPeriodization }) {
  latest = useDeloadChoice(false, p)
  return null
}
let root: Root | null = null
const mount = async (p: SessionPeriodization) => {
  root = createRoot(document.createElement('div'))
  await act(async () => { root!.render(createElement(Harness, { p })) })
}
afterEach(async () => { await act(async () => { root?.unmount() }); root = null })

describe('the Deload default ignores an aged-out prescription', () => {
  it('reads Full once the illness deload has expired, as an ISO string off the wire or a cache', async () => {
    await mount(illnessDeload(new Date(Date.now() - 60_000).toISOString()))
    expect(latest.deload).toBe(false)
    expect(latest.prescribedDeload).toBe(false)
    await act(async () => { latest.setDeload(false) })
    expect(latest.overrideFull).toBe(false) // nothing left to override
  })

  it('reads Full when the server flagged it aged out', async () => {
    await mount(illnessDeload(null, { prescription: null, prescriptionAgedOut: true }))
    expect(latest.deload).toBe(false)
  })

  it('still adopts a live deload (control)', async () => {
    await mount(illnessDeload(new Date(Date.now() + 60_000).toISOString()))
    expect(latest.deload).toBe(true)
    expect(latest.prescribedDeload).toBe(true)
  })
})
