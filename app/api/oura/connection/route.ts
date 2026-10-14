import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getRepositoryAsync } from '@/lib/data'
import { rateLimit } from '@/lib/rate-limit'
import { OuraTokenKeyMissingError } from '@/lib/oura/cloud/token-cipher'
import { disconnectOuraAccount, getOuraConnection } from '@/lib/oura/cloud/tokens'

// The signed-in user's Oura Cloud connection (#2858). GET reports it; DELETE disconnects: revokes
// the access token at Oura (best effort) and deletes the `oura_tokens` row. Neither returns a token.

function json(body: object, status = 200) {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } })
}

async function userId() {
  const session = await auth()
  return session?.user?.id ?? null
}

export async function GET() {
  const id = await userId()
  if (!id) return json({ error: 'Unauthorized' }, 401)
  if (!rateLimit(`oura-connection:${id}`, 60, 60 * 1000)) return json({ error: 'Too many requests' }, 429)
  try {
    return json(await getOuraConnection(await getRepositoryAsync(), id))
  } catch (err) {
    if (err instanceof OuraTokenKeyMissingError) return json({ error: 'Oura connection is not configured on this server.' }, 503)
    throw err
  }
}

export async function DELETE() {
  const id = await userId()
  if (!id) return json({ error: 'Unauthorized' }, 401)
  if (!rateLimit(`oura-disconnect:${id}`, 10, 10 * 60 * 1000)) return json({ error: 'Too many requests' }, 429)
  try {
    const { deleted, revoked } = await disconnectOuraAccount(await getRepositoryAsync(), id)
    return json({ disconnected: deleted, revoked })
  } catch (err) {
    if (err instanceof OuraTokenKeyMissingError) return json({ error: 'Oura connection is not configured on this server.' }, 503)
    throw err
  }
}
