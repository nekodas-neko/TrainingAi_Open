// Q-293: `ai_health_insights.context_hash` was written by one section of fourteen. The cache is
// keyed by `(user, section, date)`, so every other section served whatever was generated first
// that day — an insight written before the ring synced was the one the user read all afternoon.
//
// These drive the route end to end, because the defect was never in the helper. It was in WHERE
// the cache check sat: before the reads that build the context, which is the only thing that can
// say whether the cached text still describes the data.
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/auth', () => ({
  auth: vi.fn(async () => ({ user: { id: '00000000-0000-4000-8000-000000000293', timezone: 'Australia/Brisbane' } })),
}))
vi.mock('ai', () => ({ generateText: vi.fn(async () => ({ text: 'freshly generated' })) }))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: () => true }))
vi.mock('@/lib/ai/instrument', () => ({
  aiModel: () => ({}),
  loggedGenerateText: async (_meta: unknown, run: () => Promise<{ text: string }>) => run(),
}))

let cachedRow: { insight: string; contextHash: string | null } | null = null
let readingsScore = 80
const written: { insight: string; contextHash?: string }[] = []

vi.mock('@/lib/data', () => ({
  getRepository: async () => ({
    getAiHealthInsightWithHash: async () => cachedRow,
    upsertAiHealthInsight: async (_u: string, _s: string, _d: string, insight: string, contextHash?: string) => {
      written.push({ insight, contextHash })
    },
    getOuraDaily: async () => [{ date: '2026-08-18', sleepScore: readingsScore, readinessContributors: null, sleepContributors: null, temperatureDeviation: null }],
    getOuraDailyDerived: async () => [],
    getOuraDailySummary: async () => [],
    listSleepSessions: async () => [],
    listBodyMetrics: async () => [],
    getWorkoutSessionsFrom: async () => [],
    getUserById: async () => null,
  }),
}))

const call = async () => {
  const { POST } = await import('../route')
  const res = await POST(new Request('http://localhost/api/ai/health-insight', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ section: 'sleep', date: '2026-08-18' }),
  }))
  return (await res.json()) as { insight?: string }
}

describe('a cached insight is only served when the data still matches it (Q-293)', () => {
  beforeEach(() => { cachedRow = null; written.length = 0; readingsScore = 80 })

  it('writes a context hash alongside the insight', async () => {
    await call()
    expect(written).toHaveLength(1)
    expect(written[0].contextHash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('serves the cache when the context is unchanged', async () => {
    await call()
    cachedRow = { insight: 'the cached one', contextHash: written[0].contextHash! }
    expect((await call()).insight).toBe('the cached one')
  })

  // The bug itself. Same user, same section, same date — but the ring has since synced, so the
  // cached sentence describes readings that are no longer the readings.
  it('REGENERATES when the underlying data changed, despite the key matching', async () => {
    await call()
    const hashBefore = written[0].contextHash!
    cachedRow = { insight: 'written before the ring synced', contextHash: hashBefore }
    readingsScore = 41
    expect((await call()).insight).toBe('freshly generated')
  })

  // Every row written before its route started hashing carries NULL. That is precisely a row we
  // cannot vouch for, so it counts as a miss and costs one regeneration.
  it('treats a legacy NULL-hash row as a miss', async () => {
    cachedRow = { insight: 'legacy row from before Q-293', contextHash: null }
    expect((await call()).insight).toBe('freshly generated')
  })
})
