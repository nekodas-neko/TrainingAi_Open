import { randomBytes } from 'node:crypto'
import { NextRequest } from 'next/server'
import { z } from 'zod'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'
import { rateLimit } from '@/lib/rate-limit'
import { clientIp } from '@trainingai/shared/http/client-ip'
import { readJsonLimited } from '@trainingai/shared/http/request-guards'
import { appleNonceHash } from '@/lib/auth/apple'
import { appleResponse } from '@/lib/auth/apple-response'

const BeginSchema = z.object({ link: z.boolean().optional() }).strict()

export async function POST(req: NextRequest) {
  if (!rateLimit(`apple-begin:${clientIp(req)}`, 10, 5 * 60 * 1000)) {
    return appleResponse({ error: 'Too many sign-in attempts' }, 429)
  }
  const read = await readJsonLimited(req, 1024)
  if (!read.ok) {
    return appleResponse({ error: 'Invalid request' }, read.reason === 'too_large' ? 413 : 400)
  }
  const body = BeginSchema.safeParse(read.body)
  if (!body.success) {
    return appleResponse({ error: 'Invalid request' }, 400)
  }
  try {
    const session = body.data.link ? await auth() : null
    if (body.data.link && !session?.user.id) {
      return appleResponse({ error: 'Sign in before connecting Apple' }, 401)
    }
    const nonce = randomBytes(32).toString('base64url')
    const attempt = await (await getRepository()).createAppleAuthAttempt(appleNonceHash(nonce), session?.user.id ?? null)
    return appleResponse({ attemptId: attempt.id, nonce })
  } catch {
    return appleResponse({ error: 'Sign-in is temporarily unavailable' }, 503)
  }
}
