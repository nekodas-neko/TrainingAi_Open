import { describe, it, expect, vi, beforeEach } from 'vitest'
import { todayInTz } from '@trainingai/shared/date-utils'

// Q-291 — on 2026-08-06 the morning readiness insight said "Keep your planned exercise intensity
// low"; that evening the digest said "Keep that same energy tomorrow!". Neither surface could see
// the other. These assert on the prompt the route actually builds, because a helper test cannot
// show that the route wired the helper in — and cannot show it wired it in on the hashed side.

const USER_ID = '00000000-0000-4000-8000-000000000291'
const TODAY = todayInTz('Australia/Brisbane')

let captured = ''
let storedHash: string | undefined
let insights: { section: string; insight: string }[] = []

vi.mock('@/auth', () => ({
  auth: vi.fn(async () => ({ user: { id: USER_ID, timezone: 'Australia/Brisbane' } })),
}))
vi.mock('ai', () => ({
  generateText: vi.fn(async (args: { prompt: string }) => {
    captured = args.prompt
    return { text: 'stub digest' }
  }),
}))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: () => true }))
vi.mock('@/lib/ai/instrument', () => ({
  aiModel: () => ({}),
  loggedGenerateText: async (_meta: unknown, run: () => Promise<{ text: string }>) => run(),
}))
vi.mock('@/lib/data', () => ({
  getRepository: async () => ({
    getDaySessionSummaries: async () => [],
    listRecentPersonalRecords: async () => [],
    getActiveProgram: async () => null,
    listFoodLogs: async () => [],
    getNutritionTargets: async () => null,
    // The route early-returns `digest: null` when there is no session, no food log AND no
    // morning check-in — correctly, since it then writes nothing that could contradict
    // anything. A check-in is the cheapest way past that gate.
    getDayCheckin: async () => ({ physicalTiredness: 3, soreMuscles: ['quads'] }),
    getUserGoals: async () => ({ stepsGoal: null, stepsGoalType: 'daily' }),
    listBodyMetrics: async () => [],
    listExerciseLibrary: async () => [],
    getWorkoutSessionsFrom: async () => [],
    listFoodLogsSummary: async () => [],
    getAiHealthInsightWithHash: async () => null,
    listAiHealthInsightsForDate: async () => insights,
    upsertAiHealthInsight: async (_u: string, _s: string, _d: string, _i: string, h?: string) => { storedHash = h },
  }),
}))

const post = async () => {
  const { POST } = await import('../route')
  return POST(new Request('http://localhost/api/daily-digest', { method: 'POST' }))
}

describe('daily digest — the morning advice reaches the evening prompt (Q-291)', () => {
  beforeEach(() => { captured = ''; storedHash = undefined; insights = []; vi.resetModules() })

  it('carries the day\'s readiness insight and the instruction not to contradict it silently', async () => {
    insights = [{ section: 'readiness', insight: 'Keep your planned exercise intensity low.' }]
    expect((await post()).status).toBe(200)
    expect(captured).toContain('Already told the user today')
    expect(captured).toContain('- readiness: Keep your planned exercise intensity low.')
    expect(captured).toMatch(/without saying so plainly/)
  })

  // The half a prompt assertion cannot reach. If the block were appended after hashing, a digest
  // cached this morning would keep being served against an insight written since — the exact defect
  // Q-293 fixed for a different input, reintroduced.
  it('puts it INSIDE the context hash, not merely into the prompt', async () => {
    await post()
    const withoutInsight = storedHash

    vi.resetModules()
    insights = [{ section: 'readiness', insight: 'Keep your planned exercise intensity low.' }]
    await post()

    expect(withoutInsight).toBeTruthy()
    expect(storedHash).toBeTruthy()
    expect(storedHash).not.toBe(withoutInsight)
  })

  // A day with no insight must leave the context byte-identical to what it was before this feature,
  // or every cached digest regenerates once for nothing.
  it('adds nothing at all when the day holds no insight', async () => {
    await post()
    expect(captured).not.toContain('Already told the user today')
    expect(captured).not.toMatch(/without saying so plainly/)
  })

  // The cycle guard, at the route rather than in the helper: the digest stores its own output in
  // this same table under 'daily-digest'. Reading it back would put its own text into its own hash.
  it('does not read its own previous digest back into itself', async () => {
    insights = [{ section: 'daily-digest', insight: 'Crushing three PRs — keep that same energy tomorrow!' }]
    await post()
    expect(captured).not.toContain('Already told the user today')
    expect(captured).not.toContain('Crushing three PRs')
  })
})
