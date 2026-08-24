import { describe, it, expect, vi, beforeEach } from 'vitest'
import { metric, splitMeasured, buildPrompt } from '../prompt'

vi.mock('@/auth', () => ({
  auth: vi.fn(async () => ({ user: { id: '00000000-0000-4000-8000-000000000353', timezone: 'Australia/Brisbane' } })),
}))
vi.mock('ai', () => ({
  generateText: vi.fn(async (args: { prompt: string }) => {
    ;(globalThis as { __capturedPrompt?: string }).__capturedPrompt = args.prompt
    return { text: 'stub insight' }
  }),
}))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: () => true }))
vi.mock('@/lib/ai/instrument', () => ({
  aiModel: () => ({}),
  loggedGenerateText: async (_meta: unknown, run: () => Promise<{ text: string }>) => run(),
}))
vi.mock('@/lib/data', () => ({
  getRepository: async () => ({
    getAiHealthInsightWithHash: async () => null,
    upsertAiHealthInsight: async () => {},
    // Everything a section needs, all empty except a single readiness score — the exact shape
    // Q-452's gate lets through and this bug then misreports.
    getOuraDaily: async () => [{ date: '2026-08-18', sleepScore: 80, readinessContributors: null, sleepContributors: null, temperatureDeviation: null }],
    getOuraDailyDerived: async () => [],
    getOuraDailySummary: async () => [],
    listSleepSessions: async () => [],
    listBodyMetrics: async () => [],
    getWorkoutSessionsFrom: async () => [],
    getUserById: async () => null,
  }),
}))

// Q-353. The prompt substituted the literal string `"no data"` for an absent field at ten sites, and
// the model does not read that as absence — it asserts ZERO and editorialises. A day-one account
// handed `Steps: no data` was told *"your activity tracker currently shows zero movement… this
// inactivity creates a significant gap"*.
//
// Q-452 gated the card on a section having SOME data, which closes only the fully-empty case. The
// case these tests are about is the common one: a user with a readiness score but no ring
// temperature passes that gate and still gets the invented sentence.

describe('an absent metric is omitted, not rendered as a value', () => {
  it('omits the line and collects the label instead', () => {
    const { lines, absent } = splitMeasured([
      metric('Readiness score', '72/100 (high)'),
      metric('Body temp deviation', null),
      metric('Illness radar', undefined),
      'Past week scores: 2026-08-17 71',
    ])
    expect(lines).toEqual(['Readiness score: 72/100 (high)', 'Past week scores: 2026-08-17 71'])
    expect(absent).toEqual(['Body temp deviation', 'Illness radar'])
  })

  // The regression in one line: whatever else changes, this string must never reach the model as a
  // metric's value.
  it('never emits the literal "no data" for an absent metric', () => {
    const { lines, absent } = splitMeasured([
      metric('Steps', null),
      metric('Active calories', null),
      metric('Activity score', null),
    ])
    expect(lines).toEqual([])
    expect(JSON.stringify(lines)).not.toContain('no data')
    expect(buildPrompt('activity', lines, absent)).not.toContain('no data')
  })

  it('keeps a genuine zero, which is a measurement and not an absence', () => {
    const { lines, absent } = splitMeasured([metric('Steps', '0 (goal 8000)')])
    expect(lines).toEqual(['Steps: 0 (goal 8000)'])
    expect(absent).toEqual([])
  })

  it('treats an empty string as measured, not absent — only null/undefined mean no reading', () => {
    const { lines, absent } = splitMeasured([metric('Contributors', '')])
    expect(lines).toEqual(['Contributors: '])
    expect(absent).toEqual([])
  })
})

describe('the prompt tells the model what absence means', () => {
  it('names the absent metrics and forbids reading them as zero or behaviour', () => {
    const prompt = buildPrompt('activity', ['Activity score: 40/100 (low)'], ['Steps', 'Active calories'])
    expect(prompt).toContain('Steps, Active calories')
    expect(prompt).toMatch(/NOT zeros/)
    expect(prompt).toMatch(/observed behaviour/)
    // The specific editorialising the incident produced: low / absent / skipped / "did not".
    expect(prompt).toMatch(/low, absent, skipped/)
    expect(prompt).toContain('never build the tip around one')
  })

  // Omission alone is not enough: a section with no steps line can still have the model infer the
  // user did not walk. The instruction guards that; omission guards the value being read.
  it('still forbids inventing a value even when nothing is absent', () => {
    const prompt = buildPrompt('sleep', ['Sleep score: 80/100'], [])
    expect(prompt).toContain('never infer a value that is not listed')
    expect(prompt).not.toMatch(/Not measured today/)
  })

  it('puts the data after the instruction, unchanged', () => {
    const prompt = buildPrompt('sleep', ['Duration: 430 min', 'Efficiency: 91%'], ['Overnight HRV'])
    expect(prompt.endsWith('Data:\nDuration: 430 min\nEfficiency: 91%')).toBe(true)
  })
})

describe('the route, end to end', () => {
  const RING_USER = '00000000-0000-4000-8000-000000000353'
  let captured = ''

  beforeEach(() => { captured = '' })


  // The exact shape Q-452's gate lets through and this bug then misreports: ONE reading present
  // (a sleep score) and every other sleep field absent. Before Q-353 this prompt carried four
  // `no data` lines.
  it('sends a prompt with the score, no "no data", and the absent metrics named', async () => {
    const { POST } = await import('../route')
    const res = await POST(new Request('http://localhost/api/ai/health-insight', {
      method: 'POST',
      body: JSON.stringify({ section: 'sleep', date: '2026-08-18' }),
    }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ insight: 'stub insight' })

    const prompt = (globalThis as { __capturedPrompt?: string }).__capturedPrompt
    // Proves the model was actually reached — an empty capture would make every assertion below
    // vacuously true, which is how this test would silently stop testing anything.
    expect(prompt).toBeTruthy()
    expect(prompt).toContain('Sleep score: 80/100')
    expect(prompt).not.toContain('no data')
    for (const gone of ['Duration:', 'Efficiency:', 'Overnight HRV:', 'Avg sleeping HR:']) {
      expect(prompt).not.toContain(gone)
    }
    expect(prompt).toContain('Duration, Efficiency, Overnight HRV, Avg sleeping HR')
    expect(prompt).toMatch(/NOT zeros/)
    void RING_USER; void captured
  })
})
