import { describe, it, expect, vi } from 'vitest'
import { textStreamResponse, splitStreamError, AI_STREAM_ERROR_MARKER } from '@/lib/ai/stream'

async function* okStream() { yield 'Hello '; yield 'world' }
async function* failingStream() { yield 'Hello '; throw new Error('provider 429') }

async function readAll(res: Response): Promise<string> {
  return await res.text()
}

describe('textStreamResponse', () => {
  it('passes chunks through and calls onComplete with the full text', async () => {
    const onComplete = vi.fn().mockResolvedValue(undefined)
    const body = await readAll(textStreamResponse(okStream(), { onComplete }))
    expect(body).toBe('Hello world')
    expect(onComplete).toHaveBeenCalledWith('Hello world')
  })
  it('emits the error marker on mid-stream failure and skips onComplete', async () => {
    const onComplete = vi.fn()
    const body = await readAll(textStreamResponse(failingStream(), { onComplete }))
    expect(body).toBe('Hello ' + AI_STREAM_ERROR_MARKER)
    expect(onComplete).not.toHaveBeenCalled()
  })
  it('keeps its response out of the browser HTTP cache (Q-166)', () => {
    // The two AI streaming routes get their headers only from here, so the `private, no-store`
    // sweep reaches them through this helper rather than per-route — and a stream that *did* get
    // cached would be the worst case of all: a mid-stream error marker frozen into the cache.
    const res = textStreamResponse(okStream())
    expect(res.headers.get('Cache-Control')).toBe('private, no-store')
  })
})

describe('splitStreamError', () => {
  it('detects and strips the marker', () => {
    expect(splitStreamError('partial text ' + AI_STREAM_ERROR_MARKER)).toEqual({ text: 'partial text', errored: true })
  })
  it('leaves clean text alone', () => {
    expect(splitStreamError('all good')).toEqual({ text: 'all good', errored: false })
  })
})
