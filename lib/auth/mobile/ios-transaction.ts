import { SignJWT, jwtVerify } from 'jose'
import { PKCE_CHALLENGE_RE } from './pkce'

export const IOS_TRANSACTION_COOKIE = 'ta_mobile_ios'
export const IOS_TRANSACTION_MAX_AGE = 10 * 60
export const IOS_STATE_RE = /^[A-Za-z0-9_-]{43}$/
const IOS_CALLBACK = 'com.fitnessai.training:/auth/callback'

export type IosTransaction = { challenge: string; state: string }
type CookieStore = { get(name: string): { value: string } | undefined }

function signingKey() {
  if (!process.env.AUTH_SECRET) {
    throw new Error('Mobile authentication is not configured.')
  }
  return new TextEncoder().encode(process.env.AUTH_SECRET)
}

export async function signIosTransaction(transaction: IosTransaction) {
  return new SignJWT(transaction)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer('trainingai-mobile-signin')
    .setAudience('ios')
    .setIssuedAt()
    .setExpirationTime(`${IOS_TRANSACTION_MAX_AGE}s`)
    .sign(signingKey())
}

export async function readIosTransaction(cookieStore: CookieStore): Promise<IosTransaction | null> {
  const value = cookieStore.get(IOS_TRANSACTION_COOKIE)?.value
  if (!value) {
    return null
  }
  try {
    const { payload } = await jwtVerify(value, signingKey(), {
      algorithms: ['HS256'], issuer: 'trainingai-mobile-signin', audience: 'ios',
      maxTokenAge: IOS_TRANSACTION_MAX_AGE,
      requiredClaims: ['exp', 'iat'],
    })
    if (typeof payload.challenge !== 'string' || !PKCE_CHALLENGE_RE.test(payload.challenge)
      || typeof payload.state !== 'string' || !IOS_STATE_RE.test(payload.state)) {
      return null
    }
    return { challenge: payload.challenge, state: payload.state }
  } catch {
    return null
  }
}

export function iosBridgePath(transaction: IosTransaction) {
  return `/auth-mobile-bridge?${new URLSearchParams({ client: 'ios', ...transaction })}`
}

export function iosReturnUrl(transaction: IosTransaction, result: { token: string } | { error: 'account_pending' | 'authentication_failed' }) {
  return `${IOS_CALLBACK}?${new URLSearchParams({ state: transaction.state, ...result })}`
}

export async function iosLoginContinuation(cookieStore: CookieStore) {
  const transaction = await readIosTransaction(cookieStore)
  const callback = cookieStore.get('__Secure-authjs.callback-url') ?? cookieStore.get('authjs.callback-url')
  if (!transaction || !callback) {
    return null
  }
  try {
    const url = new URL(callback.value)
    if (`${url.pathname}${url.search}` !== iosBridgePath(transaction) || url.hash) {
      return null
    }
    return transaction
  } catch {
    return null
  }
}
