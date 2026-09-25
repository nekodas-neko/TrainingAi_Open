import { describe, expect, it } from 'vitest'
import { createInFlightGuard } from '../use-guarded-action'

/**
 * RV-178 — the latch behind `useGuardedAction`.
 *
 * Tested through the pure factory rather than the hook because the vitest config has no jsdom
 * project. That is the whole of the logic worth testing: the hook only holds one of these in a ref.
 */
describe('createInFlightGuard', () => {
  it('admits the first claim and refuses the rest', () => {
    const g = createInFlightGuard()
    expect(g.claim()).toBe(true)
    expect(g.claim()).toBe(false)
    expect(g.claim()).toBe(false)
  })

  it('admits again after a release', () => {
    const g = createInFlightGuard()
    g.claim()
    g.release()
    expect(g.claim()).toBe(true)
  })

  it('is synchronous, which is the point — state would not see the first claim', () => {
    // Five taps in one frame. A guard held in React state has every handler read the same stale
    // `false`, because no re-render lands between them.
    const g = createInFlightGuard()
    const admitted = [1, 2, 3, 4, 5].filter(() => g.claim())
    expect(admitted).toHaveLength(1)
  })

  it('a release without a claim is harmless', () => {
    const g = createInFlightGuard()
    g.release()
    expect(g.busy).toBe(false)
    expect(g.claim()).toBe(true)
  })

  it('two guards do not share a latch', () => {
    const a = createInFlightGuard()
    const b = createInFlightGuard()
    a.claim()
    expect(b.claim()).toBe(true)
  })
})
