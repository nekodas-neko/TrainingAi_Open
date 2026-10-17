import { describe, it, expect } from 'vitest'
import { aiStreamErrorText } from '@/lib/ai/provider-paused'
import { AI_PAUSED_MESSAGE, aiPausedMessageFromError } from '@/lib/ai-paused-notice'

describe('Coach stream error part (issue 2890)', () => {
  it('is the paused sentence for a billing refusal, and the client reads it', () => {
    const err = Object.assign(new Error('Your prepayment credits are depleted'), { statusCode: 429 })
    const text = aiStreamErrorText(err)
    expect(text).toBe(AI_PAUSED_MESSAGE)
    expect(aiPausedMessageFromError(new Error(text))).toBe(AI_PAUSED_MESSAGE)
  })

  it('never passes a raw provider error through', () => {
    const err = Object.assign(new Error('secret account detail'), { statusCode: 500, responseBody: 'key=abc' })
    expect(aiStreamErrorText(err)).toBe('An error occurred.')
    expect(aiStreamErrorText(new Error('boom'))).toBe('An error occurred.')
  })

  it('leaves a plain rate limit as a generic failure', () => {
    expect(aiStreamErrorText(Object.assign(new Error('Too many requests'), { statusCode: 429 }))).toBe('An error occurred.')
  })

  it('the route wires it into the stream response', async () => {
    const { readFileSync } = await import('node:fs')
    expect(readFileSync('app/api/coach/route.ts', 'utf8')).toMatch(/toUIMessageStreamResponse\(\{ onError: aiStreamErrorText \}\)/)
  })
})

describe('a billing refusal wrapped by the SDK retry (issue 2890)', () => {
  it('is found through lastError, which is how a stream failure arrives', () => {
    const inner = Object.assign(new Error('Your prepayment credits are depleted.'), { statusCode: 429 })
    const retry = Object.assign(new Error('Failed after 3 attempts'), { lastError: inner })
    expect(aiStreamErrorText(retry)).toBe(AI_PAUSED_MESSAGE)
  })
})
