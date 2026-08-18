import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'
import { SessionRpeSchema as Body } from '@trainingai/shared/validation/session-rpe'
import { rateLimit } from '@/lib/rate-limit'

export async function POST(req: Request) {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!rateLimit(`session-rpe:${userId}`, 5, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }
  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  const repo = await getRepository()
  // Q-460: the UPDATE is user-scoped, so a call naming someone else's session — or a session id
  // that does not exist at all — matches zero rows. That was reported as `200 {"success":true}`,
  // measured live three ways, which tells a client its write landed when nothing changed.
  const updated = await repo.setSessionRpe(userId, parsed.data.workoutSessionId, parsed.data.sessionRpe)
  if (!updated) return NextResponse.json({ error: 'Workout session not found' }, { status: 404 })
  return NextResponse.json({ success: true })
}
