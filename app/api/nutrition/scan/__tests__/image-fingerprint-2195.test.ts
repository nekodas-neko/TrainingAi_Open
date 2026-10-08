// #2195(d) — the image scan's fingerprint was `{mode, imageKind, note}`, so two DIFFERENT photos with
// the same (usually empty) note shared one fingerprint, and the AI-usage double-trip metric read a
// second, deliberate scan as a redundant repeat. Q-471 fixed the same shape for meal rerolls with
// `contentKey`; the scan was left out. The photo's bytes now enter the fingerprint as a key.
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest'
import { aiFingerprint } from '@/lib/ai/instrument'

const USER = '00000000-0000-4000-8000-000000219500'

vi.mock('@/auth', () => ({ auth: vi.fn(async () => ({ user: { id: USER, timezone: 'Australia/Brisbane' } })) }))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: () => true }))

const seen: unknown[] = []
vi.mock('@/lib/ai/instrument', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/ai/instrument')>()),
  aiModel: () => ({}),
  loggedGenerateObject: async (meta: { fingerprint: unknown }, run: () => Promise<unknown>) => {
    seen.push(meta.fingerprint)
    return run()
  },
}))
vi.mock('ai', () => ({ generateObject: vi.fn(async () => ({ object: { identified: false, candidates: [] } })) }))

let POST: (req: Request) => Promise<Response>
beforeAll(async () => { ({ POST } = await import('@/app/api/nutrition/scan/route')) }, 30_000)
beforeEach(() => { seen.length = 0 })

const photo = (bytes: string) => Buffer.from(bytes).toString('base64')
const scan = (body: Record<string, unknown>) => POST(new Request('http://test/api/nutrition/scan', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
}))
const fp = (f: unknown) => aiFingerprint('nutrition-scan', f)

describe('the image scan fingerprint tells two photos apart (#2195)', () => {
  it('gives two different photos with the same note different fingerprints', async () => {
    await scan({ image: photo('first photo bytes'), mimeType: 'image/jpeg' })
    await scan({ image: photo('second photo bytes'), mimeType: 'image/jpeg' })

    expect(seen).toHaveLength(2)
    expect(fp(seen[0])).not.toBe(fp(seen[1]))
  })

  it('gives the same photo the same fingerprint, so a genuine repeat is still one', async () => {
    await scan({ image: photo('same bytes'), mimeType: 'image/jpeg' })
    await scan({ image: photo('same bytes'), mimeType: 'image/jpeg' })

    expect(fp(seen[0])).toBe(fp(seen[1]))
  })

  it('still separates by note and by kind for one photo', async () => {
    await scan({ image: photo('same bytes'), mimeType: 'image/jpeg', text: 'with extra rice' })
    await scan({ image: photo('same bytes'), mimeType: 'image/jpeg', text: 'no rice' })
    expect(fp(seen[0])).not.toBe(fp(seen[1]))
  })

  it('carries a short key, not the photo or its base64', async () => {
    await scan({ image: photo('x'.repeat(5_000)), mimeType: 'image/jpeg' })
    const f = seen[0] as { image: string }
    expect(f.image).toMatch(/^[0-9a-f]{8}$/)
    expect(JSON.stringify(seen[0]).length).toBeLessThan(200)
  })
})
