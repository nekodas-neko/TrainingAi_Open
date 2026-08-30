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

  /**
   * LB-14 — a client that hangs up mid-post is not a server fault.
   *
   * The error is pinned to the shape a real disconnect produces, measured against the dev server
   * with a chunked POST whose socket is destroyed mid-body: `Error` with `code: 'ECONNRESET'` and
   * message `aborted`. **It is not a `DOMException`**, so the obvious `err.name === 'AbortError'`
   * guard would not have matched it — which is why this is caught at the read rather than
   * recognised by name anywhere.
   */
  it('reports an inbound stream that resets mid-body as aborted, not as bad JSON', async () => {
    const reset = Object.assign(new Error('aborted'), { code: 'ECONNRESET' })
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new TextEncoder().encode('{"percent":8'))
        c.error(reset)
      },
    })
    const req = new Request('http://localhost/test', {
      method: 'POST', body,
      // @ts-expect-error -- `duplex` is required for a streamed request body and is not yet in lib.dom
      duplex: 'half',
    })

    // Not `invalid_json`: the truncated bytes DO parse as broken JSON, so without the catch this
    // returns a 400 for the wrong reason after the throw has already been reported.
    expect(await readJsonLimited(req, 1024)).toEqual({ ok: false, reason: 'aborted' })
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
