// @vitest-environment jsdom
/**
 * Issue 2750, second half. Over a normal plan with ONE sore-shoulder row deloaded (the soreness and
 * illness-radar deloads are applied after the plan is made, so the plan's own `deload` flag stays
 * false), the toggle read "Full · Override" and the override did nothing: it only looked at the
 * session-level flag. Choosing Full now takes that row back to its recorded full numbers too.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'

vi.mock('@/lib/sqlite/cache', () => ({ readTodayCacheSync: () => null }))

import { useDeloadChoice } from '../use-deload-choice'
import type { SessionPeriodization } from '@trainingai/shared/types/ai-periodization'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const periodization = (over: { deload?: boolean; deloadedRows?: boolean[]; status?: string }) => ({
  prescriptionStatus: over.status ?? 'pending',
  prescription: {
    deload: over.deload ?? false,
    exercises: (over.deloadedRows ?? []).map((deloaded, i) => ({ name: `Ex ${i}`, deloaded })),
  },
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

describe('Full overrides a per-exercise deload', () => {
  it('overrides once Full is chosen over a plan with one deloaded row', async () => {
    await mount(periodization({ deloadedRows: [false, true, false] }))
    expect(latest.overrideFull).toBe(false) // nothing chosen yet: the safety deload stands
    await act(async () => { latest.setDeload(false) })
    expect(latest.overrideFull).toBe(true)
  })

  it('does not adopt a session-level Deload from a single deloaded row', async () => {
    await mount(periodization({ deloadedRows: [false, true] }))
    expect(latest.deload).toBe(false)
    expect(latest.prescribedDeload).toBe(false)
  })

  it('is off again when Deload is chosen', async () => {
    await mount(periodization({ deloadedRows: [true] }))
    await act(async () => { latest.setDeload(true) })
    expect(latest.overrideFull).toBe(false)
  })

  it('is off when no row is deloaded and the plan is not a deload (nothing to override)', async () => {
    await mount(periodization({ deloadedRows: [false, false] }))
    await act(async () => { latest.setDeload(false) })
    expect(latest.overrideFull).toBe(false)
  })

  it('is off for a consumed prescription, whose deload describes a session that already ran', async () => {
    await mount(periodization({ deloadedRows: [true], status: 'consumed' }))
    await act(async () => { latest.setDeload(false) })
    expect(latest.overrideFull).toBe(false)
  })

  it('still overrides a session-level deload plan (control)', async () => {
    await mount(periodization({ deload: true, deloadedRows: [true, true] }))
    await act(async () => { latest.setDeload(false) })
    expect(latest.overrideFull).toBe(true)
  })
})
