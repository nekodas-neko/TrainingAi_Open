import { NextResponse } from 'next/server'
import { auth } from '@/auth'

export async function POST() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  // Rest days are inferred from gaps in workout_sessions — no row needed.
  // The response signals the client to refresh the next-session recommendation.
  return NextResponse.json({ ok: true })
}
