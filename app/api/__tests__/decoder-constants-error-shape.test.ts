// `GET /api/oura-ble/decoder-constants` returned a **500 with an empty body** when the constants
// read threw (Q-455) — a client doing `res.json()` then stacked a parse exception on top of the
// original fault and learned nothing from either.
//
// The trigger was environmental (the sandbox cannot reach the model-constants bucket), and that is
// not what is filed: the shape is. `CLAUDE.md` requires routes to return a JSON error rather than
// throwing, and the first-request path exists whatever the boot check does.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const authMock = vi.fn(async () => ({ user: { id: 'u1' } }) as unknown)
vi.mock('@/auth', () => ({ auth: () => authMock() }))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: vi.fn(() => true) }))

const getStepsDecoderConstants = vi.fn(() => ({ scale: [1, 2, 3] }))
vi.mock('@/lib/oura-models/constants', () => ({
  getStepsDecoderConstants: () => getStepsDecoderConstants(),
}))

import { GET } from '@/app/api/oura-ble/decoder-constants/route'

describe('GET /api/oura-ble/decoder-constants — failure shape', () => {
  beforeEach(() => {
    getStepsDecoderConstants.mockReset().mockReturnValue({ scale: [1, 2, 3] })
    authMock.mockReset().mockResolvedValue({ user: { id: 'u1' } })
  })

  it('serves the table when it reads', async () => {
    const res = await GET()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ scale: [1, 2, 3] })
  })

  it('answers a failed read with JSON, not an empty 500', async () => {
    getStepsDecoderConstants.mockImplementation(() => { throw new Error('ENOENT') })
    const res = await GET()
    expect(res.status).toBe(500)
    // The whole point: parseable, with an `error` key. A thrown route gives neither.
    await expect(res.json()).resolves.toEqual({ error: 'Decoder constants unavailable' })
  })

  it('does not invent a fallback table', async () => {
    // There is no degraded dequantisation table. A client silently decoding step frames with the
    // wrong numbers would be worse than one that could not decode them at all.
    getStepsDecoderConstants.mockImplementation(() => { throw new Error('ENOENT') })
    const body = await (await GET()).json() as Record<string, unknown>
    expect(body.scale).toBeUndefined()
  })

  it('still refuses an anonymous caller', async () => {
    authMock.mockResolvedValue(null)
    expect((await GET()).status).toBe(401)
  })
})
