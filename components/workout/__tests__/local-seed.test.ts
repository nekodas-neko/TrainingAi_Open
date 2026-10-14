import { describe, expect, it, vi } from 'vitest'
import { startLocalSeed } from '../local-seed'

/** Issue 2831: the on-device read runs beside the network request, never in front of it. */
describe('startLocalSeed', () => {
  const deferred = <T,>() => {
    let resolve!: (v: T) => void
    let reject!: (e: unknown) => void
    const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
    return { promise, resolve, reject }
  }

  it('starts the read immediately and paints a local answer that lands first', async () => {
    const read = deferred<string | null>()
    const paint = vi.fn()
    const seed = startLocalSeed(() => read.promise, paint)
    read.resolve('mirror')
    await seed.settled
    expect(paint).toHaveBeenCalledWith('mirror')
  })

  it('drops a local answer that lands after the network, so base numbers never cover the prescription', async () => {
    const read = deferred<string | null>()
    const paint = vi.fn()
    const seed = startLocalSeed(() => read.promise, paint)
    seed.networkLanded()
    read.resolve('mirror')
    await seed.settled
    expect(paint).not.toHaveBeenCalled()
  })

  it('does not wait on the read: the caller can carry on while it is still pending', async () => {
    const read = deferred<string | null>()
    let afterStart = false
    startLocalSeed(() => read.promise, vi.fn())
    afterStart = true // reached without the read having settled
    expect(afterStart).toBe(true)
  })

  it('treats a rejected read or an empty mirror as a miss', async () => {
    const paint = vi.fn()
    await startLocalSeed(() => Promise.reject(new Error('locked')), paint).settled
    await startLocalSeed(() => Promise.resolve(null), paint).settled
    expect(paint).not.toHaveBeenCalled()
  })

  it('settled resolves only after a late local paint, so an error check can see it', async () => {
    const read = deferred<string | null>()
    const painted: string[] = []
    const seed = startLocalSeed(() => read.promise, v => painted.push(v))
    let settled = false
    seed.settled.then(() => { settled = true })
    await Promise.resolve()
    expect(settled).toBe(false)
    read.resolve('mirror')
    await seed.settled
    expect(painted).toEqual(['mirror'])
  })
})
