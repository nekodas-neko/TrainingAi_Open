import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SignJWT } from 'jose'
import { connectReturnUrl, createConnectTicket, isConnectClient, readConnectTicket } from '../connect-ticket'
import { signNativeTransaction } from '@/lib/auth/mobile/native-transaction'

const USER = '11111111-1111-4111-8111-111111111111'

describe('the Oura connect ticket, which is the OAuth state (#2858)', () => {
  const saved = process.env.AUTH_SECRET
  beforeEach(() => { process.env.AUTH_SECRET = 'test-auth-secret-at-least-32-characters!!' })
  afterEach(() => { process.env.AUTH_SECRET = saved; vi.useRealTimers() })

  it('carries the user, the client and a fresh nonce', async () => {
    const a = await createConnectTicket(USER, 'android')
    const b = await createConnectTicket(USER, 'android')
    expect(a.nonce).not.toBe(b.nonce)
    expect(await readConnectTicket(a.ticket)).toEqual({ userId: USER, client: 'android', nonce: a.nonce })
  })

  it('rejects a tampered ticket, one signed with another key, and garbage', async () => {
    const { ticket } = await createConnectTicket(USER, 'web')
    const [h, p, sig] = ticket.split('.')
    const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(p, 'base64url').toString()), sub: '22222222-2222-4222-8222-222222222222' })).toString('base64url')
    expect(await readConnectTicket(`${h}.${forged}.${sig}`)).toBeNull()
    expect(await readConnectTicket('not-a-jwt')).toBeNull()
    process.env.AUTH_SECRET = 'a-different-secret-also-32-characters-long'
    expect(await readConnectTicket(ticket)).toBeNull()
  })

  it('expires after ten minutes', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-14T02:00:00Z'))
    const { ticket } = await createConnectTicket(USER, 'web')
    vi.setSystemTime(new Date('2026-10-14T02:09:00Z'))
    expect(await readConnectTicket(ticket)).not.toBeNull()
    vi.setSystemTime(new Date('2026-10-14T02:11:00Z'))
    expect(await readConnectTicket(ticket)).toBeNull()
  })

  it('is not interchangeable with a mobile sign-in transaction on the same secret', async () => {
    const native = await signNativeTransaction({ client: 'android', challenge: 'c'.repeat(43), state: 's'.repeat(43) })
    expect(await readConnectTicket(native)).toBeNull()
  })

  it('refuses a client that is not on the allow-list', async () => {
    const key = new TextEncoder().encode(process.env.AUTH_SECRET)
    const evil = await new SignJWT({ client: 'evil-app', nonce: 'n'.repeat(43) })
      .setProtectedHeader({ alg: 'HS256' }).setSubject(USER).setIssuer('trainingai-oura-connect')
      .setAudience('oura-cloud').setIssuedAt().setExpirationTime('10m').sign(key)
    expect(await readConnectTicket(evil)).toBeNull()
    expect(isConnectClient('evil-app')).toBe(false)
    expect(isConnectClient('web')).toBe(true)
    expect(isConnectClient('android-preview')).toBe(true)
  })

  it('returns to the web Devices page on the app origin, or to the native app scheme', () => {
    const origin = 'https://trainingai-production.up.railway.app/api/oura/callback'
    expect(connectReturnUrl('web', origin, { status: 'connected' }))
      .toBe('https://trainingai-production.up.railway.app/more/devices?oura=connected')
    expect(connectReturnUrl('android', origin, { status: 'connected' })).toBe('com.trainingai.app:/oura/callback?oura=connected')
    expect(connectReturnUrl('android-preview', origin, { status: 'error', error: 'denied' }))
      .toBe('com.trainingai.app.preview:/oura/callback?oura=error&reason=denied')
    expect(connectReturnUrl('android', origin, { status: 'pending', handle: 'p1.a.b.c' }))
      .toBe('com.trainingai.app:/oura/callback?oura=pending&handle=p1.a.b.c')
  })
})
