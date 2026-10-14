import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { auth } from '@/auth'
import { getRepositoryAsync } from '@/lib/data'
import { rateLimit } from '@/lib/rate-limit'
import { safeCompare } from '@/lib/security/constant-time'
import { clientIp } from '@trainingai/shared/http/client-ip'
import { ouraOAuthConfig } from '@/lib/oura/cloud/config'
import { hasOuraTokenKey } from '@/lib/oura/cloud/token-cipher'
import { OuraAccountInUseError, exchangeOuraCode, storeOuraGrant } from '@/lib/oura/cloud/tokens'
import { sealPendingGrant } from '@/lib/oura/cloud/pending-grant'
import {
  CONNECT_NONCE_COOKIE, CONNECT_NONCE_COOKIE_PATH, connectReturnUrl, readConnectTicket, type ConnectOutcome,
} from '@/lib/oura/cloud/connect-ticket'

// Where Oura sends the browser after the consent page (#2858). The URL is `OURA_REDIRECT_URI`,
// registered with Oura; production's is https://trainingai-production.up.railway.app/api/oura/callback.
//
// What it checks: the `state` is a connect ticket this server signed for one user in the last ten
// minutes, and its nonce matches the cookie the connect leg set in this same browser. That proves the
// browser that comes back is the one that went out, NOT whose browser it is. So the grant is only
// ever committed by a request authenticated as the ticket's user (Orchestrator review on #2883):
//   - web ticket: this request must carry that user's session, or nothing is exchanged;
//   - native ticket: the system browser has no session, so the code is exchanged and sealed into a
//     handle for the app, which completes at /api/oura/connect/complete with its own bearer.
// Every outcome returns to the client the ticket names: the web Devices page or the app's scheme.

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

  // Without the settings there is no trustworthy origin to send anyone back to, so say it plainly.
  const config = ouraOAuthConfig()
  if (!config || !hasOuraTokenKey()) return plain('Oura connection is not configured on this server.', 503)

  const finish = (outcome: ConnectOutcome) => {
    const res = NextResponse.redirect(connectReturnUrl(ticket.client, config.redirectUri, outcome), 302)
    res.headers.set('Cache-Control', 'no-store')
    res.cookies.set(CONNECT_NONCE_COOKIE, '', { path: CONNECT_NONCE_COOKIE_PATH, maxAge: 0, httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production' })
    return res
  }

  const cookieNonce = req.cookies.get(CONNECT_NONCE_COOKIE)?.value
  if (!cookieNonce || !safeCompare(cookieNonce, ticket.nonce)) return finish({ status: 'error', error: 'expired' })
  if (query.data.error || !query.data.code) return finish({ status: 'error', error: 'denied' })

  const sessionUserId = (await auth().catch(() => null))?.user?.id ?? null
  if (ticket.client === 'web') {
    // The person who approved at Oura must be signed in here as the user the ticket names.
    if (sessionUserId !== ticket.userId) return finish({ status: 'error', error: 'signed_out' })
  } else if (sessionUserId && sessionUserId !== ticket.userId) {
    return finish({ status: 'error', error: 'failed' })
  }

  try {
    const repo = await getRepositoryAsync()
    // The ticket's user must still exist and be allowed in; a deactivated account connects nothing.
    const user = await repo.getUserById(ticket.userId)
    if (!user?.isActive) return finish({ status: 'error', error: 'failed' })
    const grant = await exchangeOuraCode(config, query.data.code)
    if (ticket.client !== 'web') {
      return finish({ status: 'pending', handle: sealPendingGrant({ userId: ticket.userId, client: ticket.client, grant }) })
    }
    await storeOuraGrant(repo, ticket.userId, grant)
    return finish({ status: 'connected' })
  } catch (err) {
    if (err instanceof OuraAccountInUseError) return finish({ status: 'error', error: 'in_use' })
    // The message names the failure class only; no token or code is in it.
    console.error('[oura] connect failed:', err instanceof Error ? `${err.name}: ${err.message}` : 'unknown')
    return finish({ status: 'error', error: 'failed' })
  }
}
