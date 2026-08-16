import { describe, it, expect } from 'vitest'
import { runWithConcurrency } from '../run-with-concurrency'

describe('runWithConcurrency', () => {
  it('never runs more than `limit` thunks at once', async () => {
    let inFlight = 0
    let peak = 0
    const thunks = Array.from({ length: 12 }, () => async () => {
      inFlight++
      peak = Math.max(peak, inFlight)
      await new Promise(r => setTimeout(r, 5))
      inFlight--
      return true
    })
    await runWithConcurrency(thunks, 4)
    expect(peak).toBeLessThanOrEqual(4)
  })

  it('returns settled results in input order, isolating rejections', async () => {
    const results = await runWithConcurrency([
      async () => 'a',
      async () => { throw new Error('boom') },
      async () => 'c',
    ], 2)
    expect(results[0]).toEqual({ status: 'fulfilled', value: 'a' })
    expect(results[1].status).toBe('rejected')
    expect(results[2]).toEqual({ status: 'fulfilled', value: 'c' })
  })

  it('runs every thunk exactly once even when limit exceeds the count', async () => {
    const seen: number[] = []
    await runWithConcurrency([0, 1, 2].map(i => async () => { seen.push(i); return i }), 10)
    expect(seen.sort()).toEqual([0, 1, 2])
  })
})
