import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { auth } from '@/auth'
import { rateLimit } from '@/lib/rate-limit'
import { clientIp } from '@trainingai/shared/http/client-ip'
import { readJsonLimited } from '@trainingai/shared/http/request-guards'
import { buildAuthorizeUrl, ouraOAuthConfig } from '@/lib/oura/cloud/config'
import { hasOuraTokenKey } from '@/lib/oura/cloud/token-cipher'
import {
  CONNECT_NONCE_COOKIE, CONNECT_NONCE_COOKIE_PATH, CONNECT_TICKET_MAX_AGE,
  createConnectTicket, isConnectClient, readConnectTicket,
} from '@/lib/oura/cloud/connect-ticket'

// Starting an Oura connection (#2858). The flow and why it has two legs: `lib/oura/cloud/connect-ticket.ts`.
//
// POST (signed in, web cookie or native bearer) → `{ url }`, a link to the GET below on the app's
// own origin. GET ?ticket=… (no session needed: the native app opens it in the system browser) →
// sets the nonce cookie in that browser and redirects to Oura's consent page.

const MAX_BODY_BYTES = 1024
const ConnectBody = z.object({ client: z.string().max(32).default('web') }).strict()
const TicketQuery = z.object({ ticket: z.string().min(1).max(2048) }).strict()

function json(body: object, status = 200) {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } })
}

export async function POST(req: NextRequest) {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return json({ error: 'Unauthorized' }, 401)
  if (!rateLimit(`oura-connect:${userId}`, 10, 10 * 60 * 1000)) return json({ error: 'Too many requests' }, 429)

  // No body means the web client.
  const read = await readJsonLimited(req, MAX_BODY_BYTES)
  if (!read.ok && read.reason === 'too_large') return json({ error: 'Request too large' }, 413)
  if (!read.ok && read.reason !== 'no_body' && read.reason !== 'empty') return json({ error: 'Invalid body' }, 400)
  const body = ConnectBody.safeParse(read.ok ? read.body : {})
  if (!body.success || !isConnectClient(body.data.client)) return json({ error: 'Invalid client' }, 400)

  // Fail closed before sending anyone to Oura: a consent the server cannot store is a dead end.
  const config = ouraOAuthConfig()
  if (!config || !hasOuraTokenKey()) return json({ error: 'Oura connection is not configured on this server.' }, 503)

  const { ticket } = await createConnectTicket(userId, body.data.client)
  const url = new URL('/api/oura/connect', config.redirectUri)
  url.search = new URLSearchParams({ ticket }).toString()
  return json({ url: url.toString() })
}

export async function GET(req: NextRequest) {
  if (!rateLimit(`oura-connect-open:${clientIp(req)}`, 20, 10 * 60 * 1000)) {
    return new NextResponse('Too many requests', { status: 429, headers: { 'Cache-Control': 'no-store' } })
  }
  const query = TicketQuery.safeParse({ ticket: req.nextUrl.searchParams.get('ticket') })
  const config = ouraOAuthConfig()
  if (!config || !hasOuraTokenKey()) {
    return new NextResponse('Oura connection is not configured on this server.', { status: 503, headers: { 'Cache-Control': 'no-store' } })
  }
  const ticket = query.success ? await readConnectTicket(query.data.ticket) : null
  if (!ticket || !query.success) {
    return new NextResponse('This Oura connect link has expired. Start again from the app.', { status: 400, headers: { 'Cache-Control': 'no-store' } })
  }

  const res = NextResponse.redirect(buildAuthorizeUrl(config, query.data.ticket), 302)
  res.headers.set('Cache-Control', 'no-store')
  res.cookies.set(CONNECT_NONCE_COOKIE, ticket.nonce, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    // Lax, not Strict: Oura's redirect back is a top-level cross-site GET, which Lax still sends.
    sameSite: 'lax',
    path: CONNECT_NONCE_COOKIE_PATH,
    maxAge: CONNECT_TICKET_MAX_AGE,
  })
  return res
}
