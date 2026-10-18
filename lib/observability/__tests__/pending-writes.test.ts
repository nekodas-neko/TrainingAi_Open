import { describe, it, expect, vi, beforeEach } from 'vitest'

const insertErrorEvent = vi.fn()
vi.mock('@/lib/data', () => ({
  getRepositoryAsync: async () => ({ insertErrorEvent }),
}))

describe('flushPendingReports', () => {
  beforeEach(() => { insertErrorEvent.mockReset() })

  it('resolves only after a report started before it has landed', async () => {
    let landed = false
    insertErrorEvent.mockImplementation(async () => {
      await new Promise(r => setTimeout(r, 30))
      landed = true
    })
    const { reportServerError, flushPendingReports } = await import('@/lib/observability')

    reportServerError(new Error('boom'), { url: '/x' })
    expect(landed).toBe(false)

    await flushPendingReports()
    expect(landed).toBe(true)
    expect(insertErrorEvent).toHaveBeenCalledTimes(1)
  })

  it('still resolves, and reportServerError still never throws, when the write fails', async () => {
    insertErrorEvent.mockRejectedValue(new Error('db down'))
    const { reportServerError, flushPendingReports } = await import('@/lib/observability')

    expect(() => reportServerError(new Error('boom'))).not.toThrow()
    await expect(flushPendingReports()).resolves.toBeUndefined()
  })

  it('resolves immediately when nothing is pending', async () => {
    const { flushPendingReports } = await import('@/lib/observability')
    await expect(flushPendingReports()).resolves.toBeUndefined()
  })
})
