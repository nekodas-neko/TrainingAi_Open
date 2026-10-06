import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'
import { rateLimit, settleRateLimitFlushes } from '@/lib/rate-limit'
import { reportServerError } from '@/lib/observability'
import { readJsonLimited } from '@trainingai/shared/http/request-guards'
import { ACCOUNT_DELETION_PHRASE } from '@trainingai/shared/user/account-deletion'

// One short string. Anything bigger is not this request.
const MAX_BODY_BYTES = 1024

// `.strict()` is the cross-user guard as much as the phrase check: the account deleted is ALWAYS the
// session's own, and a body that tries to name another one (`userId`, `id`, …) is refused rather
// than ignored, so a caller can never believe they deleted someone else.
const BodySchema = z.object({ confirm: z.literal(ACCOUNT_DELETION_PHRASE) }).strict()

// Every name the session cookie can carry: `__Secure-` in production, and Auth.js splits a large JWT
// into `.0`, `.1`, … chunks.
const SESSION_COOKIE = /^(__Secure-)?authjs\.session-token(\.\d+)?$/
const CANONICAL_SESSION_COOKIE = process.env.NODE_ENV === 'production'
  ? '__Secure-authjs.session-token'
  : 'authjs.session-token'

/**
 * #2120 — delete the signed-in user's own account, immediately and irreversibly.
 *
 * Fails closed at every step: no session is 401, a missing or wrong phrase is 400, and a failed
 * deletion is 500 with nothing removed (it is one transaction). On success the session is over in
 * two independent ways — the cookie is cleared on this response, and the token itself is dead,
 * because `auth()` re-reads the users row on every call and a missing row is deactivation
 * (`refreshIsActiveClaim`), so a copy of the token held elsewhere (the ring service, a bearer
 * client, another device) is refused too.
 */
export async function DELETE(req: NextRequest) {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Generous for a typo or a dropped connection, tight enough that it is never a loop.
  if (!rateLimit(`account-delete:${userId}`, 3, 60 * 60 * 1000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  const read = await readJsonLimited(req, MAX_BODY_BYTES)
  if (!read.ok) {
    return read.reason === 'too_large'
      ? NextResponse.json({ error: 'Request too large' }, { status: 413 })
      : NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  const parsed = BodySchema.safeParse(read.body)
  if (!parsed.success) {
    return NextResponse.json({ error: `Type ${ACCOUNT_DELETION_PHRASE} to confirm.` }, { status: 400 })
  }

  // The limiter writes its row in the background; let this request's land before the deletion
  // purges the user's keys, rather than after it.
  await settleRateLimitFlushes()

  let result
  try {
    const repo = await getRepository()
    result = await repo.deleteAccount(userId)
  } catch (err) {
    console.error('[account] deletion failed', err)
    reportServerError(err, { userId, url: req.nextUrl.pathname })
    return NextResponse.json(
      { error: 'Your account could not be deleted, and nothing was removed. Try again.' },
      { status: 500 },
    )
  }
  if (!result.deleted) return NextResponse.json({ error: 'Account not found' }, { status: 404 })

  const res = NextResponse.json(
    { ok: true, deleted: true, signedOut: true, anonymised: result.anonymised, purged: result.purged },
    { headers: { 'Cache-Control': 'private, no-store' } },
  )
  const names = new Set([CANONICAL_SESSION_COOKIE, ...req.cookies.getAll().map(c => c.name).filter(n => SESSION_COOKIE.test(n))])
  for (const name of names) {
    // A `__Secure-` cookie can only be overwritten by a Secure Set-Cookie; anything else is ignored.
    res.cookies.set(name, '', {
      httpOnly: true, sameSite: 'lax', path: '/', maxAge: 0,
      secure: name.startsWith('__Secure-') || process.env.NODE_ENV === 'production',
    })
  }
  return res
}
