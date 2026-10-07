import { afterEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import {
  DEV_APP_ID, MOBILE_RETURN_SCHEME_COOKIE, PRODUCTION_BACKEND_ORIGIN,
  acceptReturnScheme, isMobileAuthCompleteUrl, mobileBackendOrigin, mobileReturnUrl,
  mobileSignInBeginUrl, parseReturnScheme, returnSchemeForAppId,
} from '@/lib/auth/mobile/return-scheme'
import { MOBILE_CHALLENGE_COOKIE } from '@/lib/auth/mobile/challenge-cookie'
import { GET as begin } from '@/app/mobile-signin/begin/route'

// #2540: the Dev app signs in with Google and comes back on trainingai-dev://. The scheme is chosen
// from an allow-list of exactly two and never echoed from the request, and the real app's sign-in is
// byte-for-byte what it was.

const CHALLENGE = 'A'.repeat(43)
const PROD_APP_ID = 'com.trainingai.app'

afterEach(() => {
  vi.unstubAllEnvs()
})

const HOSTILE = [
  '', ' ', 'trainingai ', ' trainingai', 'trainingai\n', 'TrainingAI', 'TRAININGAI', 'Trainingai-Dev',
  'trainingai-DEV', 'trainingai-dev ', 'trainingai:', 'trainingai://', 'trainingai://auth-complete',
  'trainingai-dev://evil.example', 'trainingai/extra', 'trainingai-dev/extra', 'trainingai-devx',
  'trainingai-dev-evil', 'xtrainingai', 'javascript', 'javascript:', 'javascript:alert(1)', 'https',
  'http://evil.example', 'data:text/html,x', 'com.fitnessai.training', 'intent', 'trainingai%2Ddev',
  'trainingai\u0000', 'trainingai-dev​', 'trainingai,trainingai-dev',
]

describe('parseReturnScheme (the allow-list)', () => {
  it('accepts exactly the two app schemes', () => {
    expect(parseReturnScheme('trainingai')).toBe('trainingai')
    expect(parseReturnScheme('trainingai-dev')).toBe('trainingai-dev')
  })

  it.each(HOSTILE)('rejects %j', value => {
    expect(parseReturnScheme(value)).toBeNull()
  })

  it('rejects non-strings', () => {
    for (const value of [undefined, null, 0, ['trainingai'], { scheme: 'trainingai' }]) {
      expect(parseReturnScheme(value)).toBeNull()
    }
  })
})

describe('acceptReturnScheme', () => {
  it('treats an absent return as the real app, in every environment', () => {
    expect(acceptReturnScheme(null, true)).toBe('trainingai')
    expect(acceptReturnScheme(null, false)).toBe('trainingai')
  })

  it('honours the Dev scheme only on a non-production server', () => {
    expect(acceptReturnScheme('trainingai-dev', false)).toBe('trainingai-dev')
    expect(acceptReturnScheme('trainingai-dev', true)).toBeNull()
  })

  it.each(HOSTILE)('refuses %j', value => {
    expect(acceptReturnScheme(value, false)).toBeNull()
    expect(acceptReturnScheme(value, true)).toBeNull()
  })
})

describe('mobileReturnUrl (the bridge)', () => {
  it('is the real app\'s exact old URL when no Dev cookie is set', () => {
    expect(mobileReturnUrl('tok', undefined, true)).toBe('trainingai://auth-complete?token=tok')
    expect(mobileReturnUrl('tok', undefined, false)).toBe('trainingai://auth-complete?token=tok')
  })

  it('returns to the Dev app on a dev server whose begin set the Dev scheme', () => {
    expect(mobileReturnUrl('tok', 'trainingai-dev', false)).toBe('trainingai-dev://auth-complete?token=tok')
  })

  it('ignores a Dev cookie on a production server', () => {
    expect(mobileReturnUrl('tok', 'trainingai-dev', true)).toBe('trainingai://auth-complete?token=tok')
  })

  it.each(HOSTILE)('falls back to the real app for a cookie of %j, never echoing it', value => {
    expect(mobileReturnUrl('tok', value, false)).toBe('trainingai://auth-complete?token=tok')
  })
})

describe('client side', () => {
  it('maps only the Dev applicationId to the Dev scheme', () => {
    expect(returnSchemeForAppId(DEV_APP_ID)).toBe('trainingai-dev')
    for (const id of [PROD_APP_ID, null, undefined, '', 'com.trainingai.app.dev2', 'COM.TRAININGAI.APP.DEV', 'com.trainingai.app.dev ']) {
      expect(returnSchemeForAppId(id)).toBe('trainingai')
    }
  })

  it('opens the real app\'s exact old begin URL', () => {
    const origin = mobileBackendOrigin(PRODUCTION_BACKEND_ORIGIN, PROD_APP_ID)
    expect(origin).toBe('https://trainingai-production.up.railway.app')
    expect(mobileSignInBeginUrl(origin!, PROD_APP_ID, CHALLENGE))
      .toBe(`https://trainingai-production.up.railway.app/mobile-signin/begin?challenge=${CHALLENGE}`)
    // An unreadable app id is the real app.
    expect(mobileSignInBeginUrl(origin!, null, CHALLENGE))
      .toBe(`https://trainingai-production.up.railway.app/mobile-signin/begin?challenge=${CHALLENGE}`)
  })

  it('keeps the real app on production when its WebView origin is not a public https one', () => {
    for (const origin of [null, '', 'http://localhost:3000', 'https://localhost', 'capacitor://localhost', 'file://', 'not a url', 'http://trainingai-production.up.railway.app']) {
      expect(mobileBackendOrigin(origin, PROD_APP_ID)).toBe(PRODUCTION_BACKEND_ORIGIN)
    }
  })

  it('sends the Dev app to its own localhost server and asks for the Dev return', () => {
    expect(mobileBackendOrigin('http://localhost:3000', DEV_APP_ID)).toBe('http://localhost:3000')
    expect(mobileSignInBeginUrl('http://localhost:3000', DEV_APP_ID, CHALLENGE))
      .toBe(`http://localhost:3000/mobile-signin/begin?challenge=${CHALLENGE}&return=trainingai-dev`)
  })

  it('never sends the Dev app to production or anywhere off the laptop', () => {
    for (const origin of [null, '', PRODUCTION_BACKEND_ORIGIN, 'http://evil.example', 'http://localhost.evil.example', 'capacitor://localhost', 'not a url']) {
      expect(mobileBackendOrigin(origin, DEV_APP_ID)).toBeNull()
    }
  })

  it('accepts only its own completion link', () => {
    expect(isMobileAuthCompleteUrl('trainingai://auth-complete?token=t', PROD_APP_ID)).toBe(true)
    expect(isMobileAuthCompleteUrl('trainingai-dev://auth-complete?token=t', PROD_APP_ID)).toBe(false)
    expect(isMobileAuthCompleteUrl('trainingai-dev://auth-complete?token=t', DEV_APP_ID)).toBe(true)
    expect(isMobileAuthCompleteUrl('trainingai://auth-complete?token=t', DEV_APP_ID)).toBe(false)
    expect(isMobileAuthCompleteUrl('https://evil.example/trainingai://auth-complete', PROD_APP_ID)).toBe(false)
  })
})

function setCookieNames(res: Response): string[] {
  return res.headers.getSetCookie().map(c => c.split('=')[0])
}

describe('GET /mobile-signin/begin with a return scheme', () => {
  it('production: the real app\'s request gets exactly the old redirect and cookies', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    const res = await begin(new NextRequest(`https://x/mobile-signin/begin?challenge=${CHALLENGE}`))
    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toBe(`https://x/mobile-signin?challenge=${CHALLENGE}`)
    expect(setCookieNames(res).sort()).toEqual(['ta_mobile_challenge', 'ta_mobile_ios'])
    expect(res.headers.getSetCookie().join('\n')).not.toContain(MOBILE_RETURN_SCHEME_COOKIE)
  })

  it('production: a Dev return is refused', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    const res = await begin(new NextRequest(`https://x/mobile-signin/begin?challenge=${CHALLENGE}&return=trainingai-dev`))
    expect(res.headers.get('location')).toBe('https://x/sign-in')
    expect(res.cookies.get(MOBILE_CHALLENGE_COOKIE)).toBeUndefined()
  })

  it('dev server: the Dev return is carried to the bridge in an httpOnly cookie', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    const res = await begin(new NextRequest(`http://localhost:3000/mobile-signin/begin?challenge=${CHALLENGE}&return=trainingai-dev`))
    expect(res.headers.get('location')).toBe(`http://localhost:3000/mobile-signin?challenge=${CHALLENGE}`)
    const cookie = res.cookies.get(MOBILE_RETURN_SCHEME_COOKIE)
    expect(cookie?.value).toBe('trainingai-dev')
    expect(cookie?.httpOnly).toBe(true)
    expect(cookie?.sameSite).toBe('lax')
    expect(res.cookies.get(MOBILE_CHALLENGE_COOKIE)?.value).toBe(CHALLENGE)
  })

  it('dev server: a real-app request clears any earlier Dev return', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    const res = await begin(new NextRequest(`http://localhost:3000/mobile-signin/begin?challenge=${CHALLENGE}`))
    expect(res.cookies.get(MOBILE_RETURN_SCHEME_COOKIE)?.value).toBe('')
  })

  it.each(HOSTILE)('refuses return=%j without setting anything or echoing it', async value => {
    vi.stubEnv('NODE_ENV', 'development')
    const url = new URL(`http://localhost:3000/mobile-signin/begin?challenge=${CHALLENGE}`)
    url.searchParams.set('return', value)
    const res = await begin(new NextRequest(url))
    expect(res.headers.get('location')).toBe('http://localhost:3000/sign-in')
    expect(res.headers.getSetCookie()).toEqual([])
  })

  it('refuses a return scheme on the iOS path', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    vi.stubEnv('AUTH_SECRET', 'test-secret-test-secret-test-secret')
    const res = await begin(new NextRequest(`http://x/mobile-signin/begin?challenge=${CHALLENGE}&client=ios&state=${'s'.repeat(43)}&return=trainingai-dev`))
    expect(res.status).toBe(400)
  })
})
