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
  await repo.setSessionRpe(userId, parsed.data.workoutSessionId, parsed.data.sessionRpe)
  return NextResponse.json({ success: true })
}
