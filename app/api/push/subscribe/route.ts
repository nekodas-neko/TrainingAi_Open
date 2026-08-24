import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getDb } from '@/lib/data/postgres/client'
import * as s from '@/lib/data/postgres/schema'
import { and, eq } from 'drizzle-orm'
import { getVapidPublicKey } from '@/lib/push'
import { z } from 'zod'
import { readJsonLimited } from '@trainingai/shared/http/request-guards'

// A push endpoint and its keys.
const MAX_BODY_BYTES = 8 * 1024

// `existing.toJSON()`/`sub.toJSON()` (`lib/push-client.ts`) is a browser `PushSubscriptionJSON`,
// which always carries `expirationTime` (string | number | null) alongside `endpoint`/`keys` —
// omitting it here would make `.strict()` 400 every real subscribe (Q-464).
const SubscribeSchema = z.object({
  endpoint: z.string().url(),
  expirationTime: z.union([z.number(), z.null()]).optional(),
  keys: z.object({
    p256dh: z.string(),
    auth: z.string(),
  }).strict(),
}).strict()

export async function GET() {
  // Auth first (Q-454). A 503 "Push not configured" to an anonymous caller discloses deployment
  // configuration — whether this instance has VAPID keys — before it establishes that the caller is
  // anyone at all. The key it guards is a *public* key, so nothing secret was reachable; what was
  // reachable was a fact about the deployment, to anybody who asked.
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const publicKey = getVapidPublicKey()
  if (!publicKey) return NextResponse.json({ error: 'Push not configured' }, { status: 503 })
  return NextResponse.json({ publicKey })
}

export async function POST(req: NextRequest) {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: z.infer<typeof SubscribeSchema>
  try {
    const read = await readJsonLimited(req, MAX_BODY_BYTES)
    if (!read.ok) {
      return read.reason === 'too_large'
        ? NextResponse.json({ error: 'Request too large' }, { status: 413 })
        : NextResponse.json({ error: 'Invalid body' }, { status: 400 })
    }
    body = SubscribeSchema.parse(read.body)
  } catch {
    return NextResponse.json({ error: 'Invalid subscription' }, { status: 400 })
  }

  const db = getDb()
  await db.insert(s.pushSubscriptions)
    .values({ userId, endpoint: body.endpoint, p256dh: body.keys.p256dh, auth: body.keys.auth })
    .onConflictDoUpdate({
      target: [s.pushSubscriptions.userId, s.pushSubscriptions.endpoint],
      set: { p256dh: body.keys.p256dh, auth: body.keys.auth },
    })

  return NextResponse.json({ ok: true })
}

export async function DELETE(req: NextRequest) {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const read = await readJsonLimited(req, MAX_BODY_BYTES)
  if (!read.ok) {
    return read.reason === 'too_large'
      ? NextResponse.json({ error: 'Request too large' }, { status: 413 })
      : NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  const { endpoint } = (read.body ?? {}) as { endpoint?: unknown }
  // Typed explicitly now the body is `unknown` — this went straight into a Drizzle `eq()` on a
  // truthiness check alone.
  if (typeof endpoint !== 'string' || !endpoint) {
    return NextResponse.json({ error: 'Missing endpoint' }, { status: 400 })
  }

  const db = getDb()
  await db.delete(s.pushSubscriptions)
    .where(and(eq(s.pushSubscriptions.userId, userId), eq(s.pushSubscriptions.endpoint, endpoint)))

  return NextResponse.json({ ok: true })
}
