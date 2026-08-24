// Q-296: `ai_call_log.model` was the constant `AI_MODEL_ID`, so the column recorded an assumption
// rather than a measurement. Coach has run on `COACH_MODEL_ID` since 2026-08-08 and all 22 of its
// production calls since then read as `gemini-3.1-flash-lite` — the column could not disagree with
// the default, which is what made the docs and the data look like they contradicted each other.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const logged: { model: string; section: string }[] = []
vi.mock('@/lib/data', () => ({
  getRepository: async () => ({
    insertAiCallLog: async (row: { model: string; section: string }) => { logged.push(row) },
  }),
}))

const flush = () => new Promise(r => setTimeout(r, 0))

describe('ai_call_log records the model actually used (Q-296)', () => {
  beforeEach(() => { logged.length = 0 })

  it('prefers what the provider says it served', async () => {
    const { withAiLogging } = await import('../instrument')
    await withAiLogging(
      { section: 'coach', model: 'gemini-3.6-flash' },
      async () => ({ usage: {}, response: { modelId: 'gemini-3.6-flash-002' } }),
    )
    await flush()
    // Not the default, and not even what was asked for — a provider is free to route a request
    // elsewhere, and that substitution is the thing a model column exists to make visible.
    expect(logged[0].model).toBe('gemini-3.6-flash-002')
  })

  it('falls back to the model the call asked for when the response names none', async () => {
    const { withAiLogging } = await import('../instrument')
    await withAiLogging({ section: 'coach', model: 'gemini-3.6-flash' }, async () => ({ usage: {} }))
    await flush()
    expect(logged[0].model).toBe('gemini-3.6-flash')
  })

  // A call that threw has no response to read, and this is exactly where the old behaviour was
  // least defensible: a Coach failure was filed against a model Coach does not run.
  it('attributes a FAILED call to the model that failed, not the default', async () => {
    const { withAiLogging } = await import('../instrument')
    await expect(withAiLogging(
      { section: 'coach', model: 'gemini-3.6-flash' },
      async () => { throw new Error('boom') },
      () => false,
    )).rejects.toThrow('boom')
    await flush()
    expect(logged[0]).toMatchObject({ model: 'gemini-3.6-flash', section: 'coach' })
  })

  it('still records the default for a route that names no model', async () => {
    const { withAiLogging, AI_MODEL_ID } = await import('../instrument')
    await withAiLogging({ section: 'health-insight' }, async () => ({ usage: {} }))
    await flush()
    expect(logged[0].model).toBe(AI_MODEL_ID)
  })
})

describe('the fingerprint separator survived losing its raw NUL byte (Q-296)', () => {
  // instrument.ts held a literal NUL inside a template string, which made the file grep as binary —
  // the entry flagged it. `\0` is the same byte, and this pins the value so the equivalence is
  // proven rather than asserted: fingerprints are stored, so a changed separator silently orphans
  // every existing one and breaks double-trip detection.
  it('hashes to the same value as the raw byte did', async () => {
    const { aiFingerprint } = await import('../instrument')
    expect(aiFingerprint('health-insight', { date: '2026-08-24' })).toBe('8ed8b7b9858d9ebd')
  })
})
