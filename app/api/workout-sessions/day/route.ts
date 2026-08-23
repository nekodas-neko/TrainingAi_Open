import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getRepositoryAsync } from '@/lib/data'
import { DEFAULT_TZ, todayInTz, normalizeDateParam } from '@trainingai/shared/date-utils'

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const tz  = session.user?.timezone ?? DEFAULT_TZ
  const raw = req.nextUrl.searchParams.get('date')
  // getDayLog expects YYYY/MM/DD (slashes) — normalizeDateParam already returns that form.
  const slashDate = raw ? normalizeDateParam(raw) : todayInTz(tz).replace(/-/g, '/')
  if (!slashDate) return NextResponse.json({ error: 'Invalid date' }, { status: 400 })

  const repo = await getRepositoryAsync()
  // Session-columns-only query — phantom sessions with no logged exercises (abandoned
  // starts / deleted workouts whose session row lingered) are already excluded in SQL,
  // so the HR chart never paints a spurious workout band for a workout that isn't there.
  const sessions = await repo.getDaySessionSummaries(session.user.id, slashDate, tz)

  return NextResponse.json({
    date: slashDate.replace(/\//g, '-'),
    sessions: sessions.map(s => ({
      sessionId:   s.sessionId ?? null,
      sessionName: s.sessionName,
      startedAt:   s.startedAt.toISOString(),
      completedAt: s.completedAt?.toISOString() ?? null,
    })),
  }, { headers: { "Cache-Control": "private, no-store" } })
}
