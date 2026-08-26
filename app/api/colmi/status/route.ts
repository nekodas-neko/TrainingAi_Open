// Colmi ring sync status — LEARNING MODE (PS-8). Reads only the colmi_* tables.
import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getRepositoryAsync } from '@/lib/data'
import { rateLimit } from '@/lib/rate-limit'

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!rateLimit(`colmi-status:${session.user.id}`, 120, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }
  const repo = await getRepositoryAsync()
  const latest = await repo.getColmiLatestReadingAt(session.user.id)
  return NextResponse.json({ latestReadingAt: latest ? latest.toISOString() : null })
}
