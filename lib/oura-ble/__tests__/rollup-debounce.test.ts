// Q-213 Stage 3. The predicate this replaced (`frames.length < 255 || elapsed >= 8s`) was written to
// mean "the drain's last batch" and meant "any batch", so it bypassed its own coalescing window
// nearly every time. The replacement is a trailing-edge debounce with a max-wait, and the two things
// worth pinning are the two it can get wrong: firing per batch anyway, or never firing at all during
// a stream that does not pause.
//
// Clock and timers are injected, so these assert scheduling decisions rather than sleeping.
import { describe, it, expect } from 'vitest'
import { createRollupDebouncer } from '@/lib/oura-ble/rollup-debounce'

/** A controllable clock + timer queue: `advance` moves time and fires whatever came due. */
function harness() {
  let now = 0
  let seq = 0
  const queue = new Map<number, { at: number; fn: () => void }>()
  return {
    now: () => now,
    setTimer(fn: () => void, ms: number) {
      const id = seq++
      queue.set(id, { at: now + ms, fn })
      return { clear: () => queue.delete(id) }
    },
    advance(ms: number) {
      const target = now + ms
      // Fire in due order, honouring timers scheduled by other timers.
      for (;;) {
        const due = [...queue.entries()].filter(([, t]) => t.at <= target).sort((a, b) => a[1].at - b[1].at)[0]
        if (!due) break
        queue.delete(due[0])
        now = due[1].at
        due[1].fn()
      }
      now = target
    },
    pending: () => queue.size,
  }
}

function make(h: ReturnType<typeof harness>, debounceMs = 3000, maxWaitMs = 20_000) {
  const runs: string[] = []
  const d = createRollupDebouncer({
    debounceMs,
    maxWaitMs,
    run: (k) => runs.push(k),
    now: h.now,
    setTimer: h.setTimer,
  })
  return { d, runs }
}

describe('rollup debouncer (Q-213 Stage 3)', () => {
  it('does not run while batches are still arriving', () => {
    const h = harness()
    const { d, runs } = make(h)
    // Six batches two seconds apart — a drain. The old predicate ran on every one of these.
    for (let i = 0; i < 6; i++) {
      d.schedule('u1')
      h.advance(2000)
    }
    expect(runs).toEqual([])
  })

  it('runs once, after the batches stop', () => {
    const h = harness()
    const { d, runs } = make(h)
    for (let i = 0; i < 6; i++) {
      d.schedule('u1')
      h.advance(2000)
    }
    h.advance(3000)
    expect(runs).toEqual(['u1'])
    // And stays run — no second firing from a stale timer.
    h.advance(60_000)
    expect(runs).toEqual(['u1'])
  })

  it('still runs during a stream that never pauses long enough to settle', () => {
    const h = harness()
    const { d, runs } = make(h)
    // A batch every second for a minute: the trailing edge never arrives, so only the max-wait can
    // fire this. Without it the rollup would be starved for the whole drain.
    for (let i = 0; i < 60; i++) {
      d.schedule('u1')
      h.advance(1000)
    }
    expect(runs.length).toBeGreaterThanOrEqual(2)
    expect(runs.every((k) => k === 'u1')).toBe(true)
    // Bounded too — the point is coalescing, so it must be far below one run per batch.
    expect(runs.length).toBeLessThan(10)
  })

  it('keys users separately', () => {
    const h = harness()
    const { d, runs } = make(h)
    d.schedule('u1')
    d.schedule('u2')
    h.advance(3000)
    expect(runs.sort()).toEqual(['u1', 'u2'])
  })

  it('one user going quiet does not delay another', () => {
    const h = harness()
    const { d, runs } = make(h)
    d.schedule('u1')
    h.advance(1000)
    d.schedule('u2') // u2 starts later; u1's own trailing edge must still land on time
    h.advance(2000)
    expect(runs).toEqual(['u1'])
    h.advance(1000)
    expect(runs).toEqual(['u1', 'u2'])
  })

  it('cancel drops a pending run and leaves no timer behind', () => {
    const h = harness()
    const { d, runs } = make(h)
    d.schedule('u1')
    d.cancel('u1')
    h.advance(60_000)
    expect(runs).toEqual([])
    expect(h.pending()).toBe(0)
  })
})
