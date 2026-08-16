import { describe, it, expect, beforeEach } from 'vitest'
import { resetRequestErrorDedupe, shouldRecordRequestError } from '@/lib/observability/request-error'

describe('shouldRecordRequestError', () => {
  beforeEach(() => resetRequestErrorDedupe())

  it('records the first occurrence', () => {
    expect(shouldRecordRequestError('GET /api/x|boom', 1_000)).toBe(true)
  })

  it('suppresses the same failure repeating inside the window', () => {
    // A hot loop in a broken route must not be able to fill the DB — it is the binding constraint
    // on this project, ~9 MB/day against a 1 GB volume.
    shouldRecordRequestError('GET /api/x|boom', 1_000)
    expect(shouldRecordRequestError('GET /api/x|boom', 1_000 + 59_999)).toBe(false)
  })

  it('records it again once the window has passed', () => {
    shouldRecordRequestError('GET /api/x|boom', 1_000)
    expect(shouldRecordRequestError('GET /api/x|boom', 1_000 + 60_000)).toBe(true)
  })

  it('does not let one route suppress a different route or a different message', () => {
    shouldRecordRequestError('GET /api/x|boom', 1_000)
    expect(shouldRecordRequestError('GET /api/y|boom', 1_000)).toBe(true)
    expect(shouldRecordRequestError('GET /api/x|other', 1_000)).toBe(true)
  })

  it('stays bounded under a high-cardinality error stream', () => {
    // Distinct keys every time is the shape of an error carrying an id or timestamp in its
    // message. The map must not grow with it.
    for (let i = 0; i < 5_000; i++) shouldRecordRequestError(`GET /api/x|boom ${i}`, 1_000 + i)
    // Still functioning, and a fresh key is still recorded rather than the map being wedged.
    expect(shouldRecordRequestError('GET /api/new|first time', 10_000)).toBe(true)
  })

  it('keeps suppressing a genuinely hot key while others churn around it', () => {
    shouldRecordRequestError('GET /api/hot|boom', 1_000)
    for (let i = 0; i < 50; i++) shouldRecordRequestError(`GET /api/x|n${i}`, 1_000 + i)
    expect(shouldRecordRequestError('GET /api/hot|boom', 2_000)).toBe(false)
  })
})
