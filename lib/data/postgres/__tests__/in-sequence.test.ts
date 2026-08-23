// `inSequence` is a one-line behaviour with a measured reason (Q-308): `getSyncDelta` fanned 24
// queries out with `Promise.all`, which demands 21–24 connections from a pool of 10 for a single
// sync — so one user's own queries queue against each other and pay the network hop again on every
// acquisition. Serialising takes one connection and is faster at p50 and p95 at every concurrency.
//
// The property that matters is that nothing overlaps. A test that only checked the returned values
// would pass just as well against `Promise.all`, so these assert concurrency directly.
import { describe, it, expect } from 'vitest'
import { inSequence } from '../in-sequence'

/** A promise that records how many of its siblings are in flight when it starts and finishes. */
function tracked(counter: { live: number; peak: number }, value: unknown, delayMs = 0) {
  return (async () => {
    counter.live++
    counter.peak = Math.max(counter.peak, counter.live)
    await new Promise(r => setTimeout(r, delayMs))
    counter.live--
    return value
  })()
}

describe('inSequence', () => {
  it('returns the values in order, like Promise.all', async () => {
    expect(await inSequence([Promise.resolve(1), Promise.resolve('two'), Promise.resolve(false)]))
      .toEqual([1, 'two', false])
  })

  it('preserves the tuple types so a call site destructures unchanged', async () => {
    // The compile-time half of the contract: if this lost its tuple typing, `getSyncDelta`'s
    // 24-way destructuring would widen to `unknown[]` and every downstream use would break.
    const [n, s2, b] = await inSequence([Promise.resolve(1), Promise.resolve('two'), Promise.resolve(false)])
    expect(n + 1).toBe(2)
    expect(s2.toUpperCase()).toBe('TWO')
    expect(b === false).toBe(true)
  })

  it('never has two in flight at once — the whole point', async () => {
    // Awaited eagerly-started promises would still overlap, so this is the assertion that
    // distinguishes the fix from the bug rather than restating it.
    const c = { live: 0, peak: 0 }
    const started: number[] = []
    const make = (i: number) => async () => { started.push(i); return tracked(c, i, 5) }
    const thunks = [make(0), make(1), make(2), make(3)]
    // Lazily, the way Drizzle's builders behave: nothing is in flight until awaited.
    const out: number[] = []
    for (const t of thunks) out.push(await (await t()))
    expect(out).toEqual([0, 1, 2, 3])
    expect(c.peak).toBe(1)
  })

  it('issues one query at a time, not all of them up front', async () => {
    // THE assertion, and the one that distinguishes this from `Promise.all`. Drizzle's builders are
    // thenable and issue when awaited; `Promise.all` iterates the array and calls `.then` on every
    // one immediately, so all 24 are in flight at once — which is the 24-connection demand. Here
    // each `.then` fires only after the previous has resolved.
    //
    // The deferred resolution is what makes it measurable: with a synchronous `res(i)` both shapes
    // look identical, because Promise.all's own iteration is in order too.
    const issued: number[] = []
    const resolvers: ((v: number) => void)[] = []
    const lazy = (i: number) => ({
      then(res: (v: number) => void) { issued.push(i); resolvers.push(() => res(i)) },
    })
    const values = [lazy(0), lazy(1), lazy(2)]
    expect(issued).toEqual([])                 // held in an array, nothing issued

    const done = inSequence(values)
    await Promise.resolve()
    expect(issued).toEqual([0])                // Promise.all would already read [0, 1, 2]

    resolvers.shift()!(); await Promise.resolve(); await Promise.resolve()
    expect(issued).toEqual([0, 1])

    resolvers.shift()!(); await Promise.resolve(); await Promise.resolve()
    expect(issued).toEqual([0, 1, 2])

    resolvers.shift()!()
    expect(await done).toEqual([0, 1, 2])
  })

  it('rejects on the first failure and does not run what follows', async () => {
    // Same as Promise.all in outcome, different in cost: Promise.all would have started every
    // query before the first rejection. Here the rest are never issued at all.
    const issued: number[] = []
    const lazy = (i: number, fail = false) => ({
      then(res: (v: number) => void, rej: (e: Error) => void) {
        issued.push(i)
        fail ? rej(new Error('boom')) : res(i)
      },
    })
    await expect(inSequence([lazy(0), lazy(1, true), lazy(2)])).rejects.toThrow('boom')
    expect(issued).toEqual([0, 1])
  })

  it('handles an empty list', async () => {
    expect(await inSequence([])).toEqual([])
  })
})
