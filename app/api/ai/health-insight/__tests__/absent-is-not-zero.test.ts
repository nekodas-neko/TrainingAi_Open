import { describe, it, expect, vi } from 'vitest'
import { metric, splitMeasured } from '../metrics'
import { buildInsightText } from '../insight-text'

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
    expect(buildInsightText({ lines, absent })).not.toContain('no data')
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

describe('the rendered insight says what absence means (RV-201)', () => {
  // The prompt used to spend a paragraph instructing the model not to read a missing reading as a
  // zero, as "low", or as something the owner did or did not do. These assert the property that
  // paragraph was asking for, now that a template rather than a model decides the wording.
  it('names the absent metrics and says only that no reading exists', () => {
    const text = buildInsightText({
      headline: { label: 'Activity', value: '40/100', band: 'low' },
      lines: [],
      absent: ['Steps', 'Active calories'],
    })
    expect(text).toContain('No reading was recorded today for Steps and Active calories.')
    // The specific editorialising the incident produced.
    expect(text).not.toMatch(/\b(skipped|did not|no steps|zero)\b/i)
  })

  it('cannot describe an absent metric as a value, because absent labels never reach the readout', () => {
    const { lines, absent } = splitMeasured([
      metric('Steps', null),
      metric('Active calories', '350 kcal'),
    ])
    const text = buildInsightText({ lines, absent })
    expect(text).toContain('350 kcal')
    // "Steps" appears once, in the absence sentence — never as "Steps: something".
    expect(text).not.toMatch(/Steps: /)
    expect(text).toContain('No reading was recorded today for Steps.')
  })

  // A mutation that appended the absent labels to the "Also recorded" readout survived the first
  // version of this file: the assertions looked for "Steps: ", and a BARE label slipped through.
  // An absent metric must appear in exactly one place — the sentence that says no reading exists.
  it('lets an absent label appear only in the absence sentence, never in the readout', () => {
    const text = buildInsightText({
      headline: { label: 'Activity', value: '44/100', band: 'low' },
      lines: ['Steps: 3120 (goal 8000)'],
      absent: ['Active calories', 'Illness radar'],
    })
    const marker = 'No reading was recorded today for'
    const [readout, absence] = [text.slice(0, text.indexOf(marker)), text.slice(text.indexOf(marker))]
    for (const label of ['Active calories', 'Illness radar']) {
      expect(readout, `"${label}" reached the readout, where it reads as a value`).not.toContain(label)
      expect(absence).toContain(label)
    }
    expect(readout).toContain('Steps: 3120')
  })

  it('says nothing about absence when nothing is absent', () => {
    const text = buildInsightText({
      headline: { label: 'Sleep score', value: '80/100', band: 'good' },
      lines: [],
      absent: [],
    })
    expect(text).toBe('Sleep score is 80/100 (good).')
    expect(text).not.toMatch(/No reading/)
  })

  it('uses the band word, never a superlative the band does not support (Q-292)', () => {
    const text = buildInsightText({
      headline: { label: 'Sleep score', value: '80/100', band: 'good' },
      lines: [],
      absent: [],
    })
    expect(text).toContain('(good)')
    expect(text).not.toMatch(/perfect|excellent|amazing|flawless/i)
  })
})
