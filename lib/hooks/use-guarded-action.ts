import { useCallback, useRef } from 'react'

/**
 * A latch that admits one caller at a time.
 *
 * Pure and synchronous on purpose: two taps in the same frame are the case this exists for, and a
 * guard held in React state fails it — both handlers read the same stale `false` before either
 * re-render lands. A ref (or this closure) is the only thing that sees the first claim.
 */
export function createInFlightGuard() {
  let busy = false
  return {
    /** True if the claim was granted. A caller that gets `false` must do nothing. */
    claim(): boolean {
      if (busy) return false
      busy = true
      return true
    },
    release(): void { busy = false },
    get busy(): boolean { return busy },
  }
}

/**
 * Wrap an async handler so a second call while the first is still running is dropped (RV-178).
 *
 * Two live examples of why: `clonePhaseSet` made a second copy of a phase set on a double tap, and
 * the AI insight card's Refresh spent the route's 10-per-hour budget on however many times you
 * tapped it. Neither had a try/catch either, so a network failure left the user with nothing —
 * `onError` here is what makes the guard safe to add, because a rejected promise that never
 * released the latch would leave the button dead until remount.
 */
export function useGuardedAction<A extends unknown[]>(
  fn: (...args: A) => Promise<void>,
  onError?: (err: unknown) => void,
): (...args: A) => Promise<void> {
  // Both are held in refs so the returned callback is stable — a new identity every render would
  // defeat the `memo()` of any child it is passed to, which is the other half of this same entry.
  const guard = useRef(createInFlightGuard())
  const fnRef = useRef(fn)
  fnRef.current = fn
  const onErrorRef = useRef(onError)
  onErrorRef.current = onError

  return useCallback(async (...args: A) => {
    if (!guard.current.claim()) return
    try {
      await fnRef.current(...args)
    } catch (err) {
      onErrorRef.current?.(err)
    } finally {
      guard.current.release()
    }
  }, [])
}
