import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { auth } from '@/auth'
import { getRepositoryAsync } from '@/lib/data'
import { rateLimit } from '@/lib/rate-limit'
import { safeCompare } from '@/lib/security/constant-time'
import { clientIp } from '@trainingai/shared/http/client-ip'
import { ouraOAuthConfig } from '@/lib/oura/cloud/config'
import { hasOuraTokenKey } from '@/lib/oura/cloud/token-cipher'
import { OuraAccountInUseError, connectOuraAccount } from '@/lib/oura/cloud/tokens'
import {
  CONNECT_NONCE_COOKIE, CONNECT_NONCE_COOKIE_PATH, connectReturnUrl, readConnectTicket, type ConnectOutcome,
} from '@/lib/oura/cloud/connect-ticket'

// Where Oura sends the browser after the consent page (#2858). The URL is `OURA_REDIRECT_URI`,
// registered with Oura; production's is https://trainingai-production.up.railway.app/api/oura/callback.
//
// No session is required, because the native app runs this leg in the system browser. What proves
// the request instead: the `state` is a connect ticket this server signed for one user in the last
// ten minutes, and its nonce matches the cookie the connect leg set in this same browser. When a web
// session IS present it must be the ticket's user. Every outcome returns to the client the ticket
// names: the web app's Devices page or the native app's own scheme.

const CallbackQuery = z.object({
  state: z.string().min(1).max(2048),
  code: z.string().min(1).max(2048).optional(),
  error: z.string().max(256).optional(),
}).strict()

function plain(message: string, status: number) {
  return new NextResponse(message, { status, headers: { 'Cache-Control': 'no-store' } })
}

export async function GET(req: NextRequest) {
  if (!rateLimit(`oura-callback:${clientIp(req)}`, 20, 10 * 60 * 1000)) return plain('Too many requests', 429)

  const params = req.nextUrl.searchParams
  const query = CallbackQuery.safeParse({
    state: params.get('state') ?? undefined,
    code: params.get('code') ?? undefined,
    error: params.get('error') ?? undefined,
  })
  const ticket = query.success ? await readConnectTicket(query.data.state) : null
  // Without a valid ticket there is no client to return to and no user to connect.
  if (!query.success || !ticket) return plain('This Oura connection could not be verified. Start again from the app.', 400)

  const config = ouraOAuthConfig()
  const finish = (outcome: ConnectOutcome) => {
    const res = NextResponse.redirect(connectReturnUrl(ticket.client, config?.redirectUri ?? req.nextUrl.origin, outcome), 302)
    res.headers.set('Cache-Control', 'no-store')
    res.cookies.set(CONNECT_NONCE_COOKIE, '', { path: CONNECT_NONCE_COOKIE_PATH, maxAge: 0, httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production' })
    return res
  }

  const cookieNonce = req.cookies.get(CONNECT_NONCE_COOKIE)?.value
  if (!cookieNonce || !safeCompare(cookieNonce, ticket.nonce)) return finish({ status: 'error', error: 'expired' })

  const session = await auth().catch(() => null)
  if (session?.user?.id && session.user.id !== ticket.userId) return finish({ status: 'error', error: 'failed' })

  if (query.data.error || !query.data.code) return finish({ status: 'error', error: 'denied' })
  if (!config || !hasOuraTokenKey()) return finish({ status: 'error', error: 'not_configured' })

  try {
    const repo = await getRepositoryAsync()
    // The ticket's user must still exist and be allowed in; a deactivated account connects nothing.
    const user = await repo.getUserById(ticket.userId)
    if (!user?.isActive) return finish({ status: 'error', error: 'failed' })
    await connectOuraAccount(repo, config, ticket.userId, query.data.code)
    return finish({ status: 'connected' })
  } catch (err) {
    if (err instanceof OuraAccountInUseError) return finish({ status: 'error', error: 'in_use' })
    // The message names the failure class only; no token or code is in it.
    console.error('[oura] connect failed:', err instanceof Error ? `${err.name}: ${err.message}` : 'unknown')
    return finish({ status: 'error', error: 'failed' })
  }
}
