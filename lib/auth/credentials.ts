import Credentials from 'next-auth/providers/credentials'
import { verifyPassword } from './password'
import { normalizeEmail } from '@trainingai/shared/validation/email'
import { clientIp } from '@trainingai/shared/http/client-ip'
import { getRepositoryAsync } from '@/lib/data'
import { rateLimit } from '@/lib/rate-limit'
import { userClaims } from './user'

const LOGIN_WINDOW_MS = 15 * 60 * 1000

export const credentialsProvider = Credentials({
  credentials: {
    email: { label: 'Email', type: 'email' },
    password: { label: 'Password', type: 'password' },
    mobileState: { type: 'hidden' },
  },
  async authorize(credentials, request) {
    const { email: submitted, password, mobileState } = credentials
    if (typeof submitted !== 'string' || !submitted || submitted.length > 320
      || typeof password !== 'string' || !password || password.length > 4096) {
      return null
    }

    const email = normalizeEmail(submitted)
    if (!rateLimit(`login-ip:${clientIp(request)}`, 50, LOGIN_WINDOW_MS)) {
      return null
    }
    if (!rateLimit(`login:${email}`, 20, LOGIN_WINDOW_MS)) {
      return null
    }

    const repository = await getRepositoryAsync()
    const user = await repository.getUserByEmail(email)
    if (!user?.passwordHash || !await verifyPassword(password, user.passwordHash)) {
      return null
    }

    return {
      ...userClaims(user),
      email: user.email,
      name: user.name ?? null,
      mobileState: typeof mobileState === 'string' ? mobileState : undefined,
    }
  },
})
