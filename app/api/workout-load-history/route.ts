import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'
import { DEFAULT_TZ, toAestDay } from '@trainingai/shared/date-utils'
import type { LoadComparisonEntry } from '@/components/health/workout-load-comparison-chart'

export async function GET(req: Request) {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const sessionId = searchParams.get('sessionId')
  const sessionName = searchParams.get('sessionName')
  if (!sessionId && !sessionName) return NextResponse.json({ error: 'sessionId or sessionName required' }, { status: 400 })

  const tz = session.user?.timezone ?? DEFAULT_TZ
  const repo = await getRepository()
  const from90d = new Date(Date.now() - 90 * 86_400_000)
  const sessions = await repo.getWorkoutSessionsFrom(userId, from90d)

  // Prefer matching by the program session's stable id — a session-name match breaks
  // continuity the moment the session is renamed. Fall back to name only for callers
  // that don't have an id yet (session identity = DB id, CLAUDE.md).
  const matching = sessions
    .filter(ws => (sessionId ? ws.sessionId === sessionId : ws.sessionName === sessionName) && ws.exercises.length > 0)
    .sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime())
    .slice(-5)

  const entries: LoadComparisonEntry[] = matching.map((ws, i) => ({
    date: toAestDay(ws.startedAt, tz),
    volumeKg: Math.round(ws.exercises.reduce((s, ex) => s + (ex.volume ?? 0), 0)),
    durationMin: ws.completedAt ? Math.round((ws.completedAt.getTime() - ws.startedAt.getTime()) / 60_000) : null,
    isToday: i === matching.length - 1,
  }))

  return NextResponse.json(entries, { headers: { 'Cache-Control': 'private, no-store' } })
}
