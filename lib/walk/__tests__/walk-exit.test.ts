import { describe, expect, it, vi } from 'vitest'
import { registerWalkExit, requestWalkExit } from '../walk-exit'

describe('walk exit registry (#2134)', () => {
  it('reports that nobody answered when the walk screen is not mounted', () => {
    // The back listener falls through to its ordinary back on `false`; a `true` here with no
    // screen behind it would leave the gesture doing nothing on the route's error boundary.
    expect(requestWalkExit()).toBe(false)
  })

  it('hands the request to the registered screen and reports it was taken', () => {
    const open = vi.fn()
    const unregister = registerWalkExit(open)
    expect(requestWalkExit()).toBe(true)
    expect(open).toHaveBeenCalledTimes(1)
    unregister()
  })

  it('stops answering once the screen unmounts', () => {
    const open = vi.fn()
    registerWalkExit(open)()
    expect(requestWalkExit()).toBe(false)
    expect(open).not.toHaveBeenCalled()
  })

  it('a stale unregister cannot remove a newer screen', () => {
    // StrictMode and a remount both register before the previous cleanup has run: the old cleanup
    // landing late must not take the new registration with it.
    const first = vi.fn()
    const second = vi.fn()
    const unregisterFirst = registerWalkExit(first)
    const unregisterSecond = registerWalkExit(second)
    unregisterFirst()
    expect(requestWalkExit()).toBe(true)
    expect(second).toHaveBeenCalledTimes(1)
    expect(first).not.toHaveBeenCalled()
    unregisterSecond()
  })
})
