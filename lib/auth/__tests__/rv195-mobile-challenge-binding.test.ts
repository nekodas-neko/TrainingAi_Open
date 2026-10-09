import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const CHALLENGE = 'A'.repeat(43)
const OTHER = 'B'.repeat(43)

let cookieJar: Record<string, string> = {}
const store = { getAll: () => Object.entries(cookieJar).map(([name, value]) => ({ name, value })), get: (name: string) => (name in cookieJar ? { value: cookieJar[name] } : undefined) }
const createMobileAuthToken = vi.fn<(cookie: string, challenge: string) => string>(() => 'minted-token')
vi.mock('@/lib/auth/mobile/tokens', () => ({ createMobileAuthToken: (c: string, ch: string) => createMobileAuthToken(c, ch) }))

import { challengeMatchesCookie, MOBILE_CHALLENGE_COOKIE } from '@/lib/auth/mobile/challenge-cookie'
import { GET as begin } from '@/app/mobile-signin/begin/route'
import { mintMobileBridgeToken } from '@/lib/auth/mobile/bridge'

const bridge = (challenge: string) => mintMobileBridgeToken(challenge, store)

beforeEach(() => {
  cookieJar = { 'authjs.session-token': 'session-jwt' }
  createMobileAuthToken.mockClear()
})

describe('challengeMatchesCookie', () => {
  it('matches only an identical, well-formed challenge', () => {
    expect(challengeMatchesCookie(CHALLENGE, CHALLENGE)).toBe(true)
    expect(challengeMatchesCookie(CHALLENGE, OTHER)).toBe(false)
    expect(challengeMatchesCookie(CHALLENGE, undefined)).toBe(false)
    expect(challengeMatchesCookie('short', 'short')).toBe(false)
  })
})

describe('GET /mobile-signin/begin', () => {
  it('stores the challenge in an httpOnly cookie and continues to the Google step', async () => {
    const res = await begin(new NextRequest(`http://x/mobile-signin/begin?challenge=${CHALLENGE}`))
    expect(res.headers.get('location')).toBe(`/mobile-signin?challenge=${CHALLENGE}`)
    const cookie = res.cookies.get(MOBILE_CHALLENGE_COOKIE)
    expect(cookie?.value).toBe(CHALLENGE)
    expect(cookie?.httpOnly).toBe(true)
    expect(cookie?.sameSite).toBe('lax')
  })

  it('sets nothing for a malformed challenge', async () => {
    const res = await begin(new NextRequest('http://x/mobile-signin/begin?challenge=nope'))
    expect(res.headers.get('location')).toBe('/sign-in')
    expect(res.cookies.get(MOBILE_CHALLENGE_COOKIE)).toBeUndefined()
  })

  it('never puts the request\'s own host in the redirect (production sent the tab to localhost:8080)', async () => {
    // Behind Railway's proxy a route handler sees the container's address as req.url. The tab
    // must follow a path, which the browser resolves against the public origin it is already on.
    const res = await begin(new NextRequest(`https://localhost:8080/mobile-signin/begin?challenge=${CHALLENGE}`))
    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toBe(`/mobile-signin?challenge=${CHALLENGE}`)
    const bad = await begin(new NextRequest('https://localhost:8080/mobile-signin/begin?challenge=nope'))
    expect(bad.headers.get('location')).toBe('/sign-in')
  })
})

describe('/auth-mobile-bridge (mintMobileBridgeToken)', () => {
  it('mints for the challenge this tab registered', async () => {
    cookieJar[MOBILE_CHALLENGE_COOKIE] = CHALLENGE
    expect(bridge(CHALLENGE)).toBe('minted-token')
    expect(createMobileAuthToken).toHaveBeenCalledWith('session-jwt', CHALLENGE)
  })

  it('assembles chunked Auth.js cookies in numeric order', () => {
    cookieJar = { [MOBILE_CHALLENGE_COOKIE]: CHALLENGE, 'authjs.session-token.1': 'second', 'authjs.session-token.0': 'first' }
    expect(bridge(CHALLENGE)).toBe('minted-token')
    expect(createMobileAuthToken).toHaveBeenCalledWith('firstsecond', CHALLENGE)
  })

  it('refuses a missing cookie chunk', () => {
    cookieJar = { [MOBILE_CHALLENGE_COOKIE]: CHALLENGE, 'authjs.session-token.0': 'first', 'authjs.session-token.2': 'third' }
    expect(bridge(CHALLENGE)).toBeNull()
    expect(createMobileAuthToken).not.toHaveBeenCalled()
  })

  it('refuses a challenge the tab never registered, and one that differs from it', async () => {
    expect(bridge(CHALLENGE)).toBeNull()
    cookieJar[MOBILE_CHALLENGE_COOKIE] = OTHER
    expect(bridge(CHALLENGE)).toBeNull()
    expect(createMobileAuthToken).not.toHaveBeenCalled()
  })
})
