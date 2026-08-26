// BF-35 — the Open Food Facts thumbnail, fetched once and stored as bytes.
//
// The interesting property is not the happy path: it is that this function can never fail a food
// save. A picture is decoration on a row whose nutrition is already correct, so every failure mode
// has to come back as `null` and leave BF-32's placeholder in place. Each case below is one way the
// fetch can go wrong.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { fetchOffThumbDataUri, OFF_FIELDS } from '../open-food-facts'

const CAP = 16 * 1024
const jpegBytes = (n: number) => new Uint8Array(n).fill(0x41)

function mockFetch(res: Partial<Response> | Error) {
  vi.stubGlobal('fetch', vi.fn(async () => {
    if (res instanceof Error) throw res
    return res as Response
  }))
}

const ok = (bytes: Uint8Array, type = 'image/jpeg') => ({
  ok: true,
  headers: new Headers({ 'content-type': type }),
  arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
})

afterEach(() => vi.unstubAllGlobals())

describe('OFF_FIELDS', () => {
  // The whole "an image costs nothing extra" claim is this one field riding a call already made.
  it('asks for the thumbnail, so no second request is needed to find one', () => {
    expect(OFF_FIELDS).toContain('image_front_thumb_url')
  })
})

describe('fetchOffThumbDataUri', () => {
  it('returns a data URI carrying the response content type', async () => {
    mockFetch(ok(jpegBytes(64)))
    const out = await fetchOffThumbDataUri('https://off/x.jpg', CAP)
    expect(out).toMatch(/^data:image\/jpeg;base64,/)
  })

  it('round-trips the bytes it was given', async () => {
    mockFetch(ok(new Uint8Array([1, 2, 3, 250])))
    const out = await fetchOffThumbDataUri('https://off/x.jpg', CAP)
    const b64 = out!.split(',')[1]
    expect([...atob(b64)].map(c => c.charCodeAt(0))).toEqual([1, 2, 3, 250])
  })

  it('is null for an absent URL, without fetching', async () => {
    const spy = vi.fn()
    vi.stubGlobal('fetch', spy)
    expect(await fetchOffThumbDataUri(undefined, CAP)).toBeNull()
    expect(spy).not.toHaveBeenCalled()
  })

  it('is null on a non-2xx', async () => {
    mockFetch({ ok: false, headers: new Headers(), arrayBuffer: async () => new ArrayBuffer(0) })
    expect(await fetchOffThumbDataUri('https://off/x.jpg', CAP)).toBeNull()
  })

  // OFF serving an HTML error page is the realistic version of this, and storing it as an image
  // would put a broken tile on the row forever.
  it('is null when the body is not an image', async () => {
    mockFetch(ok(jpegBytes(64), 'text/html'))
    expect(await fetchOffThumbDataUri('https://off/x.jpg', CAP)).toBeNull()
  })

  it('tolerates a charset on the content type', async () => {
    mockFetch(ok(jpegBytes(64), 'image/jpeg; charset=binary'))
    expect(await fetchOffThumbDataUri('https://off/x.jpg', CAP)).not.toBeNull()
  })

  it('is null over the cap, and fine at exactly the cap', async () => {
    mockFetch(ok(jpegBytes(CAP + 1)))
    expect(await fetchOffThumbDataUri('https://off/x.jpg', CAP)).toBeNull()
    mockFetch(ok(jpegBytes(CAP)))
    expect(await fetchOffThumbDataUri('https://off/x.jpg', CAP)).not.toBeNull()
  })

  it('is null on an empty body', async () => {
    mockFetch(ok(new Uint8Array(0)))
    expect(await fetchOffThumbDataUri('https://off/x.jpg', CAP)).toBeNull()
  })

  // The one that matters most: a thrown fetch must not propagate into the food save.
  it('swallows a thrown fetch rather than rejecting', async () => {
    mockFetch(new Error('ECONNRESET'))
    await expect(fetchOffThumbDataUri('https://off/x.jpg', CAP)).resolves.toBeNull()
  })
})
