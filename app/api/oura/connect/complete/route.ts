import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { auth } from '@/auth'
import { getRepositoryAsync } from '@/lib/data'
import { rateLimit } from '@/lib/rate-limit'
import { readJsonLimited } from '@trainingai/shared/http/request-guards'
import { hasOuraTokenKey } from '@/lib/oura/cloud/token-cipher'
import { openPendingGrant } from '@/lib/oura/cloud/pending-grant'
import { OuraAccountInUseError, discardOuraGrant, storeOuraGrant } from '@/lib/oura/cloud/tokens'

// The native app finishes an Oura connection here (#2858). The callback ran in the system browser,
// which has no session, so it sealed the grant into `handle` instead of storing it
// (`lib/oura/cloud/pending-grant.ts`). This request carries the app's own bearer, and the grant is
// stored only when that user is the one who started the connect. Anyone else's handle is revoked at
// Oura and never stored: that is what stops a connect link sent to a victim from collecting their
// Oura data.

const MAX_BODY_BYTES = 8 * 1024
const CompleteBody = z.object({ handle: z.string().min(1).max(6 * 1024) }).strict()

function json(body: object, status = 200) {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } })
}

export async function POST(req: NextRequest) {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return json({ error: 'Unauthorized' }, 401)
  if (!rateLimit(`oura-connect-complete:${userId}`, 10, 10 * 60 * 1000)) return json({ error: 'Too many requests' }, 429)
  if (!hasOuraTokenKey()) return json({ error: 'Oura connection is not configured on this server.' }, 503)

  const read = await readJsonLimited(req, MAX_BODY_BYTES)
  if (!read.ok) return json({ error: read.reason === 'too_large' ? 'Request too large' : 'Invalid body' }, read.reason === 'too_large' ? 413 : 400)
  const body = CompleteBody.safeParse(read.body)
  if (!body.success) return json({ error: 'Invalid body' }, 400)

  const pending = openPendingGrant(body.data.handle)
  if (!pending) return json({ error: 'This Oura connection has expired. Connect again.' }, 410)
  if (pending.userId !== userId) {
    await discardOuraGrant(pending.grant)
    return json({ error: 'This Oura connection was started by another account.' }, 403)
  }

  try {
    await storeOuraGrant(await getRepositoryAsync(), userId, pending.grant)
  } catch (err) {
    if (err instanceof OuraAccountInUseError) return json({ error: err.message }, 409)
    throw err
  }
  return json({ connected: true })
}
