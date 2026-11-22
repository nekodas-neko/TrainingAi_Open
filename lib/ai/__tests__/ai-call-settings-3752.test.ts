/**
 * #3752 — call settings live in one table, keyed by section.
 *
 * Before this each route passed `maxRetries: 0` by hand (ten call sites), the Coach set its thinking
 * level inline, and the model was picked by which of two helpers a route called. Moving them into
 * `AI_SECTIONS` must change nothing a call does, so the first block pins every section to the values
 * it ran with before — written out here, not read back from the table.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const streamTextMock = vi.fn((params: unknown) => ({ params }))
vi.mock('ai', () => ({
  generateText: vi.fn(),
  generateObject: vi.fn(),
  streamText: (params: unknown) => streamTextMock(params),
}))
vi.mock('@ai-sdk/google', () => ({
  google: (id: string) => ({ modelId: id }),
}))
vi.mock('@/lib/data', () => ({
  getRepository: async () => ({ insertAiCallLog: async () => {} }),
}))

import {
  AI_SECTIONS, aiCallSettings, aiSectionSettings, withAiLogging, loggedStreamText, type AiSection,
} from '../instrument'
import { AI_CALL_BUDGET_MS } from '../deadline'

const FLASH_LITE = 'gemini-3.1-flash-lite'
const FLASH = 'gemini-3.6-flash'

/** What each section ran with before the table: model, thinking, SDK retries, wrapper time limit. */
const BEFORE: Record<string, { model: string; thinking: string | null; retries: number; timeLimitMs: number | null }> = {
  prescription: { model: FLASH_LITE, thinking: null, retries: 0, timeLimitMs: 30_000 },
  'exercises-generate': { model: FLASH_LITE, thinking: null, retries: 0, timeLimitMs: 30_000 },
  'generate-program': { model: FLASH_LITE, thinking: null, retries: 0, timeLimitMs: 30_000 },
  'builder-chat': { model: FLASH_LITE, thinking: null, retries: 0, timeLimitMs: 30_000 },
  'meal-plan-generate': { model: FLASH_LITE, thinking: null, retries: 0, timeLimitMs: 30_000 },
  'meal-plan-generate-meal': { model: FLASH_LITE, thinking: null, retries: 0, timeLimitMs: 30_000 },
  'meal-plan-edit-meal': { model: FLASH_LITE, thinking: null, retries: 0, timeLimitMs: 30_000 },
  'meal-plan-top-up': { model: FLASH_LITE, thinking: null, retries: 0, timeLimitMs: 30_000 },
  'nutrition-scan': { model: FLASH_LITE, thinking: null, retries: 0, timeLimitMs: 30_000 },
  // The Coach never set `maxRetries`, so the SDK default of 2 applied. A stream has no wrapper budget.
  coach: { model: FLASH, thinking: 'minimal', retries: 2, timeLimitMs: null },
  // The picture tool's own loop was three attempts (two retries) and it has no wrapper budget.
  'exercise-image': { model: 'gemini-3.1-flash-image-preview', thinking: null, retries: 2, timeLimitMs: null },
}

describe('AI_SECTIONS pins every section to the settings it ran with before (#3752)', () => {
  it('has exactly the sections that existed, no more and no fewer', () => {
    expect(Object.keys(AI_SECTIONS).sort()).toEqual(Object.keys(BEFORE).sort())
  })

  for (const [section, before] of Object.entries(BEFORE)) {
    it(`${section}: model, thinking, retries and time limit are unchanged`, () => {
      expect({ ...aiSectionSettings(section as AiSection) }).toEqual(before)
    })
  }

  it('the shared object-call budget is still the 30 s total', () => {
    expect(AI_CALL_BUDGET_MS).toBe(30_000)
  })

  it('has no temperature anywhere', () => {
    for (const s of Object.values(AI_SECTIONS)) expect(Object.keys(s)).not.toContain('temperature')
    expect(Object.keys(aiCallSettings('coach'))).not.toContain('temperature')
  })
})

describe('aiCallSettings', () => {
  it('gives an object section the model and no SDK retry, with no provider options', () => {
    const s = aiCallSettings('prescription')
    expect(s.model).toEqual({ modelId: FLASH_LITE })
    expect(s.maxRetries).toBe(0)
    expect('providerOptions' in s).toBe(false)
  })

  it('gives the Coach its model, its thinking level and the default two retries', () => {
    const s = aiCallSettings('coach')
    expect(s.model).toEqual({ modelId: FLASH })
    expect(s.maxRetries).toBe(2)
    expect(s.providerOptions).toEqual({ google: { thinkingConfig: { thinkingLevel: 'minimal' } } })
  })

  it('refuses a section the table does not have', () => {
    expect(() => aiSectionSettings('made-up' as AiSection)).toThrow(/AI_SECTIONS/)
  })

  it('refuses names every object inherits, as it does any unknown section', () => {
    for (const name of ['constructor', 'toString', 'hasOwnProperty', '__proto__', 'valueOf']) {
      expect(() => aiSectionSettings(name as AiSection)).toThrow(/AI_SECTIONS/)
      expect(() => aiCallSettings(name as AiSection)).toThrow(/AI_SECTIONS/)
    }
  })
})

describe('the wrapper applies the table', () => {
  beforeEach(() => streamTextMock.mockClear())

  it('hands withAiLogging calls the section settings', async () => {
    let seen: ReturnType<typeof aiCallSettings> | undefined
    await withAiLogging({ section: 'nutrition-scan' }, async (_signal, settings) => {
      seen = settings
      return { usage: {} }
    })
    expect(seen?.model).toEqual({ modelId: FLASH_LITE })
    expect(seen?.maxRetries).toBe(0)
  })

  it('applies the Coach entry to loggedStreamText, and a caller cannot override it', () => {
    loggedStreamText(
      { section: 'coach' },
      { system: 's', maxRetries: 9, model: { modelId: 'other' }, providerOptions: {} } as never,
    )
    const sent = streamTextMock.mock.calls[0][0] as Record<string, unknown>
    expect(sent.model).toEqual({ modelId: FLASH })
    expect(sent.maxRetries).toBe(2)
    expect(sent.providerOptions).toEqual({ google: { thinkingConfig: { thinkingLevel: 'minimal' } } })
    expect(sent.system).toBe('s')
  })
})
