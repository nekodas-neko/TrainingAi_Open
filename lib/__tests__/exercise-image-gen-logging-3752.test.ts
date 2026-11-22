/**
 * #3752 — the admin picture tool spends from the same Gemini key as the live app and wrote nothing to
 * `ai_call_log`. Each model request now writes one row under its own section, success or failure.
 * Mocks only: no Gemini call is made.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import sharp from 'sharp'

const rows: Record<string, unknown>[] = []
vi.mock('@/lib/data', () => ({
  getRepository: async () => ({ insertAiCallLog: async (r: Record<string, unknown>) => { rows.push(r) } }),
}))

const generateContent = vi.fn()
const generateImages = vi.fn()
vi.mock('@google/genai', () => ({
  Modality: { IMAGE: 'IMAGE' },
  GoogleGenAI: class { models = { generateContent, generateImages } },
}))
vi.mock('@/lib/ai/dev-call-budget', () => ({ takeDevAiCall: () => {}, recordDevAiCall: () => {}, assertDevAiBudget: () => {} }))

import { generateExerciseImage } from '@/lib/exercise-image-gen'

const flush = () => new Promise(r => setTimeout(r, 0))
let png: string
beforeEach(async () => {
  rows.length = 0
  generateContent.mockReset()
  generateImages.mockReset()
  png = (await sharp({ create: { width: 4, height: 4, channels: 3, background: '#808080' } }).png().toBuffer()).toString('base64')
})

describe('exercise-image-gen writes ai_call_log', () => {
  it('logs a successful Gemini image request under its own section, with the model and token counts', async () => {
    generateContent.mockResolvedValue({ data: png, usageMetadata: { promptTokenCount: 11, candidatesTokenCount: 1290, totalTokenCount: 1301 } })
    await generateExerciseImage('a squat', 'gemini-3.1-flash-image-preview')
    await flush()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      section: 'exercise-image', model: 'gemini-3.1-flash-image-preview', ok: true,
      inputTokens: 11, outputTokens: 1290, totalTokens: 1301, userId: null,
    })
    expect(typeof rows[0].latencyMs).toBe('number')
  })

  it('logs every attempt, and a reply with no image is a failed row', async () => {
    generateContent
      .mockResolvedValueOnce({ text: 'sorry', usageMetadata: {} })
      .mockResolvedValueOnce({ data: png, usageMetadata: {} })
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const p = generateExerciseImage('a squat')
    await vi.advanceTimersByTimeAsync(2500)
    await p
    vi.useRealTimers()
    await flush()
    expect(rows.map(r => r.ok)).toEqual([false, true])
    expect(rows.every(r => r.section === 'exercise-image')).toBe(true)
  })

  it('logs a request that threw, and rethrows it', async () => {
    generateContent.mockRejectedValue(new Error('quota'))
    await expect(generateExerciseImage('a squat')).rejects.toThrow('quota')
    await flush()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ section: 'exercise-image', ok: false })
  })

  it('logs an Imagen request too', async () => {
    generateImages.mockResolvedValue({ generatedImages: [{ image: { imageBytes: png } }] })
    await generateExerciseImage('a squat', 'imagen-4.0-generate-001')
    await flush()
    expect(rows[0]).toMatchObject({ section: 'exercise-image', model: 'imagen-4.0-generate-001', ok: true })
  })

  it('makes three attempts at most, as before (one try and two retries)', async () => {
    generateContent.mockResolvedValue({ text: 'no', usageMetadata: {} })
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const p = generateExerciseImage('a squat').catch(e => e)
    await vi.advanceTimersByTimeAsync(10_000)
    expect((await p) as Error).toBeInstanceOf(Error)
    vi.useRealTimers()
    expect(generateContent).toHaveBeenCalledTimes(3)
  })
})
