import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock the data layer the fire-and-forget logger dynamically imports, so the test
// is hermetic (no real DB) and can assert what gets logged.
const insertAiCallLog = vi.fn(async () => {})
vi.mock('@/lib/data', () => ({
  getRepository: async () => ({ insertAiCallLog }),
}))

import { aiFingerprint, contentKey, AI_MODEL_ID, withAiLogging, loggedGenerateObject } from '../instrument'

// The insert is fired without await (never blocks the AI call), so tests wait a
// macrotask for it to land.
const flush = () => new Promise(r => setTimeout(r, 0))

beforeEach(() => insertAiCallLog.mockClear())

describe('contentKey — free text as a key, so it can enter a fingerprint (Q-471)', () => {
  it('is deterministic and 8 hex chars', () => {
    expect(contentKey('Chicken rice bowl')).toBe(contentKey('Chicken rice bowl'))
    expect(contentKey('Chicken rice bowl')).toMatch(/^[0-9a-f]{8}$/)
  })

  it('is empty for no content, so an absent optional input does not shift the key', () => {
    expect(contentKey()).toBe('')
    expect(contentKey(undefined, null, '')).toBe('')
    // `stores: []` and no stores at all must fingerprint identically.
    expect(contentKey(...[])).toBe(contentKey(undefined))
  })

  it('is order-sensitive, unlike the object-key sort in aiFingerprint', () => {
    // Deliberate: `avoidNames` carries the plan's meals in slot order, so a reorder IS a different
    // request. The sort in `stableStringify` applies to object keys, never to array members.
    expect(contentKey('a', 'b')).not.toBe(contentKey('b', 'a'))
  })

  it('separates its parts, so ["ab","c"] and ["a","bc"] do not collide', () => {
    expect(contentKey('ab', 'c')).not.toBe(contentKey('a', 'bc'))
  })
})

describe('meal-plan fingerprints tell a reroll from a double trip (Q-471)', () => {
  // The bug: all three meal-plan sections fingerprinted on a rounded calorie target alone, so a
  // deliberate reroll — same target, different meal to avoid — was indistinguishable from the same
  // call firing twice. It was the top row of the AI-usage screen: 32 redundant, 4 distinct.
  const fp = (avoidNames: string[]) =>
    aiFingerprint('meal-plan-generate-meal', {
      kcal: 620,
      avoid: contentKey(...avoidNames),
      instruction: contentKey(undefined),
      meal: contentKey(undefined),
    })

  it('a reroll differs, because the meal being replaced is in avoidNames', () => {
    expect(fp(['Chicken rice bowl'])).not.toBe(fp(['Chicken rice bowl', 'Beef stir fry']))
  })

  it('a genuine repeat — identical request, twice — still fingerprints the same', () => {
    expect(fp(['Chicken rice bowl'])).toBe(fp(['Chicken rice bowl']))
  })

  it('two slots at the same calorie target no longer collide', () => {
    expect(fp(['Oats and berries'])).not.toBe(fp(['Salmon and potatoes']))
  })
})

describe('aiFingerprint', () => {
  it('is deterministic for the same section + input', () => {
    expect(aiFingerprint('health-insight', { date: '2026-07-21', section: 'sleep' }))
      .toBe(aiFingerprint('health-insight', { date: '2026-07-21', section: 'sleep' }))
  })

  it('is independent of object key order', () => {
    expect(aiFingerprint('x', { a: 1, b: 2 })).toBe(aiFingerprint('x', { b: 2, a: 1 }))
  })

  it('differs by section', () => {
    expect(aiFingerprint('sleep', { d: 1 })).not.toBe(aiFingerprint('readiness', { d: 1 }))
  })

  it('differs by input', () => {
    expect(aiFingerprint('s', { d: 1 })).not.toBe(aiFingerprint('s', { d: 2 }))
  })

  it('produces a 16-char hex hash', () => {
    expect(aiFingerprint('s', 'anything')).toMatch(/^[0-9a-f]{16}$/)
  })
})

describe('AI_MODEL_ID', () => {
  it('is the pinned flash-lite model', () => {
    expect(AI_MODEL_ID).toBe('gemini-3.1-flash-lite')
  })
})

describe('withAiLogging', () => {
  it('returns the call result and logs usage with ok=true', async () => {
    const result = await withAiLogging(
      { section: 'test-sec', userId: 'u1', fingerprint: { a: 1 } },
      async () => ({ usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 }, text: 'hi' }),
    )
    expect(result.text).toBe('hi')
    await flush()
    expect(insertAiCallLog).toHaveBeenCalledTimes(1)
    expect(insertAiCallLog).toHaveBeenCalledWith(expect.objectContaining({
      section: 'test-sec', userId: 'u1', model: 'gemini-3.1-flash-lite',
      inputTokens: 10, outputTokens: 5, totalTokens: 15, ok: true,
    }))
    // fingerprint is hashed, never the raw input
    expect(insertAiCallLog.mock.calls[0][0].fingerprint).toMatch(/^[0-9a-f]{16}$/)
  })

  it('derives totalTokens from input+output when the SDK omits it', async () => {
    await withAiLogging({ section: 's', fingerprint: 'k' }, async () => ({ usage: { inputTokens: 7, outputTokens: 3 } }))
    await flush()
    expect(insertAiCallLog.mock.calls[0][0].totalTokens).toBe(10)
  })

  it('rethrows the underlying error and logs ok=false', async () => {
    const boom = new Error('model exploded')
    await expect(withAiLogging(
      { section: 'fail-sec', userId: 'u2', fingerprint: 'k' },
      async () => { throw boom },
    )).rejects.toBe(boom)
    await flush()
    expect(insertAiCallLog).toHaveBeenCalledWith(expect.objectContaining({ section: 'fail-sec', ok: false }))
  })

  it('never throws or rejects because logging failed', async () => {
    insertAiCallLog.mockRejectedValueOnce(new Error('db down'))
    const result = await withAiLogging({ section: 's', fingerprint: 'k' }, async () => ({ usage: {}, ok: 1 }))
    expect(result.ok).toBe(1)
    await flush() // swallowed, no unhandled rejection
  })

  it('logs a null fingerprint when none is provided', async () => {
    await withAiLogging({ section: 's' }, async () => ({ usage: { totalTokens: 1 } }))
    await flush()
    expect(insertAiCallLog.mock.calls[0][0].fingerprint).toBeNull()
  })
})

describe('loggedGenerateObject', () => {
  it('delegates through withAiLogging and logs the section', async () => {
    const r = await loggedGenerateObject({ section: 'obj-sec', userId: 'u', fingerprint: 'k' }, async () => ({ object: { ok: true }, usage: { totalTokens: 42 } }))
    expect(r.object.ok).toBe(true)
    await flush()
    expect(insertAiCallLog).toHaveBeenCalledWith(expect.objectContaining({ section: 'obj-sec', totalTokens: 42, ok: true }))
  })
})
