import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getDb } from '@/lib/data/postgres/client'
import * as s from '@/lib/data/postgres/schema'
import { and, eq } from 'drizzle-orm'
import { getVapidPublicKey } from '@/lib/push'
import { z } from 'zod'

const SubscribeSchema = z.object({
  endpoint: z.string().url(),
  keys: z.object({
    p256dh: z.string(),
    auth: z.string(),
  }),
})

export async function GET() {
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
    body = SubscribeSchema.parse(await req.json())
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

  const { endpoint } = await req.json()
  if (!endpoint) return NextResponse.json({ error: 'Missing endpoint' }, { status: 400 })

  const db = getDb()
  await db.delete(s.pushSubscriptions)
    .where(and(eq(s.pushSubscriptions.userId, userId), eq(s.pushSubscriptions.endpoint, endpoint)))

  return NextResponse.json({ ok: true })
}
