// Q-295: `ai_call_log` had no cached-token column, so nobody could tell whether Gemini's IMPLICIT
// caching was already serving part of the Coach prompt. That mattered because the entry proposed
// adding an EXPLICIT cache — an optimisation nobody could measure, stacked on one nobody could see.
//
// The behaviour worth pinning is not "the number is copied across". It is the null/0 distinction:
// null means the provider reported nothing, 0 means it reported a cache MISS. Collapsing them (a
// `||`, or a `DEFAULT 0` on the column) would make every historical call read as a measured miss
// and answer the entry's question wrongly in the confident direction.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const logged: { cachedInputTokens: number | null; inputTokens: number | null }[] = []
vi.mock('@/lib/data', () => ({
  getRepository: async () => ({
    insertAiCallLog: async (row: { cachedInputTokens: number | null; inputTokens: number | null }) => { logged.push(row) },
  }),
}))

const flush = () => new Promise(r => setTimeout(r, 0))

describe('ai_call_log records provider cache hits (Q-295)', () => {
  beforeEach(() => { logged.length = 0 })

  it('records the current field, inputTokenDetails.cacheReadTokens', async () => {
    const { withAiLogging } = await import('../instrument')
    await withAiLogging({ section: 'coach' }, async () => ({
      usage: { inputTokens: 8000, outputTokens: 50, inputTokenDetails: { cacheReadTokens: 6500 } },
    }))
    await flush()
    expect(logged[0].cachedInputTokens).toBe(6500)
  })

  // The SDK still ships `cachedInputTokens` as a deprecated alias, and which of the two a provider
  // populates is a version detail we should not have to track.
  it('falls back to the deprecated cachedInputTokens alias', async () => {
    const { withAiLogging } = await import('../instrument')
    await withAiLogging({ section: 'coach' }, async () => ({
      usage: { inputTokens: 8000, cachedInputTokens: 4096 },
    }))
    await flush()
    expect(logged[0].cachedInputTokens).toBe(4096)
  })

  it('prefers the current field when a provider reports both', async () => {
    const { withAiLogging } = await import('../instrument')
    await withAiLogging({ section: 'coach' }, async () => ({
      usage: { inputTokens: 10, inputTokenDetails: { cacheReadTokens: 7 }, cachedInputTokens: 3 },
    }))
    await flush()
    expect(logged[0].cachedInputTokens).toBe(7)
  })

  // The whole point of the column. A `||` here would turn a reported miss into "said nothing",
  // and the cache-hit rate this entry exists to measure would be computed off the wrong denominator.
  it('keeps a reported MISS as 0, not null', async () => {
    const { withAiLogging } = await import('../instrument')
    await withAiLogging({ section: 'coach' }, async () => ({
      usage: { inputTokens: 8000, inputTokenDetails: { cacheReadTokens: 0 } },
    }))
    await flush()
    expect(logged[0].cachedInputTokens).toBe(0)
    expect(logged[0].cachedInputTokens).not.toBeNull()
  })

  it('is null when the provider reports no cache information at all', async () => {
    const { withAiLogging } = await import('../instrument')
    await withAiLogging({ section: 'health-insight' }, async () => ({ usage: { inputTokens: 160 } }))
    await flush()
    expect(logged[0].cachedInputTokens).toBeNull()
    // and the rest of the row is unaffected
    expect(logged[0].inputTokens).toBe(160)
  })

  it('is null when the call reports no usage at all', async () => {
    const { withAiLogging } = await import('../instrument')
    await withAiLogging({ section: 'coach' }, async () => ({}))
    await flush()
    expect(logged[0].cachedInputTokens).toBeNull()
  })
})
