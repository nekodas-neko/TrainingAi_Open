import { NextRequest } from 'next/server'
import { z } from 'zod'
import { errors } from 'jose'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'
import { rateLimit } from '@/lib/rate-limit'
import { clientIp } from '@trainingai/shared/http/client-ip'
import { readJsonLimited } from '@trainingai/shared/http/request-guards'
import { verifyAppleIdentityToken } from '@/lib/auth/apple'
import { appleResponse } from '@/lib/auth/apple-response'
import { IdentityConflict } from '@/lib/auth/identity'
import { issueNativeSession } from '@/lib/auth/mobile/session'

const CompleteSchema = z.object({
  attemptId: z.string().uuid(), identityToken: z.string().min(1).max(8192), name: z.string().trim().min(1).max(100).optional(),
}).strict()

export async function POST(req: NextRequest) {
  if (!rateLimit(`apple-complete:${clientIp(req)}`, 10, 5 * 60 * 1000)) {
    return appleResponse({ error: 'Too many sign-in attempts' }, 429)
  }
  const read = await readJsonLimited(req, 12 * 1024)
  if (!read.ok) {
    return appleResponse({ error: 'Invalid request' }, read.reason === 'too_large' ? 413 : 400)
  }
  const body = CompleteSchema.safeParse(read.body)
  if (!body.success) {
    return appleResponse({ error: 'Invalid request' }, 400)
  }
  try {
    const repository = await getRepository()
    const attempt = await repository.getAppleAuthAttempt(body.data.attemptId)
    if (!attempt) {
      return appleResponse({ error: 'Sign-in expired. Start again.' }, 401)
    }
    const session = attempt.userId ? await auth() : null
    if (attempt.userId && session?.user.id !== attempt.userId) {
      return appleResponse({ error: 'Sign in before connecting Apple' }, 401)
    }
    let identity: Awaited<ReturnType<typeof verifyAppleIdentityToken>>
    try {
      identity = await verifyAppleIdentityToken(body.data.identityToken, attempt.nonceHash)
    } catch (error) {
      if (error instanceof errors.JWKSTimeout || error instanceof TypeError) {
        return appleResponse({ error: 'Apple sign-in is temporarily unavailable' }, 503)
      }
      return appleResponse({ error: 'Invalid Apple identity' }, 401)
    }
    if (!await repository.consumeAppleAuthAttempt(attempt.id)) {
      return appleResponse({ error: 'Sign-in expired. Start again.' }, 401)
    }
    let user = await repository.getUserByProvider('apple', identity.subject)
    if (attempt.userId) {
      if (!await repository.linkIdentity(attempt.userId, 'apple', identity.subject, identity.email)) {
        return appleResponse({ error: 'Apple is already connected to a different account' }, 409)
      }
      user = await repository.getUserById(attempt.userId)
    } else if (!user) {
      if (!identity.email) {
        return appleResponse({ error: 'Allow Apple to share an email address, then try again.' }, 400)
      }
      user = await repository.createProviderUser('apple', identity.subject, identity.email, body.data.name)
    }
    if (!user?.isActive) {
      return appleResponse({ error: 'account_pending' }, 403)
    }
    return appleResponse(await issueNativeSession(user))
  } catch (error) {
    const cause = error instanceof Error ? error.cause as { code?: string } | undefined : undefined
    if (error instanceof IdentityConflict || cause?.code === '23505') {
      return appleResponse({ error: 'account_link_required' }, 409)
    }
    return appleResponse({ error: 'Sign-in is temporarily unavailable' }, 503)
  }
}
