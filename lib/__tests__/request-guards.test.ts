import { describe, it, expect } from 'vitest'
import { readJsonLimited, isAllowedImageMime } from '@trainingai/shared/http/request-guards'

function post(body: string, headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/test', { method: 'POST', body, headers })
}

describe('readJsonLimited', () => {
  it('parses a small valid JSON body', async () => {
    const result = await readJsonLimited(post('{"a":1}'), 1024)
    expect(result).toEqual({ ok: true, body: { a: 1 } })
  })
  it('rejects via Content-Length before reading the stream', async () => {
    const fake = { headers: new Headers({ 'content-length': '99999999' }), body: null } as unknown as Request
    expect(await readJsonLimited(fake, 1024)).toEqual({ ok: false, reason: 'too_large' })
  })
  it('rejects a streamed body that exceeds the limit', async () => {
    // 100-byte JSON against a 50-byte cap
    const big = `{"pad":"${'x'.repeat(90)}"}`
    expect(await readJsonLimited(post(big), 50)).toEqual({ ok: false, reason: 'too_large' })
  })
  it('rejects invalid JSON within the limit', async () => {
    expect(await readJsonLimited(post('not json'), 1024)).toEqual({ ok: false, reason: 'invalid_json' })
  })
})

describe('isAllowedImageMime', () => {
  it.each(['image/jpeg', 'image/png', 'image/webp'])('allows %s', (m) => {
    expect(isAllowedImageMime(m)).toBe(true)
  })
  it.each(['image/gif', 'image/svg+xml', 'text/html', '', undefined, 42, 'IMAGE/JPEG; charset=x'])(
    'rejects %s', (m) => { expect(isAllowedImageMime(m)).toBe(false) },
  )
})
