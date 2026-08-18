import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'
import { requireAdmin, adminErrorResponse } from '@/lib/admin'
import { computeExerciseStats, computeEquipmentStats, decomposeSessions } from '@trainingai/shared/workout/time-audit'

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    await requireAdmin(session.user.id, session.user.isAdmin)
  } catch (err) {
    return adminErrorResponse(err)
  }

  const daysRaw = Number(req.nextUrl.searchParams.get('days') ?? 90)
  const days = Number.isFinite(daysRaw) ? Math.min(365, Math.max(7, Math.round(daysRaw))) : 90

  const repo = await getRepository()
  const { sets, exercises, sessions } = await repo.getTimingAuditData(session.user.id, days)

  return NextResponse.json({
    days,
    equipment: computeEquipmentStats(exercises),
    exercises: computeExerciseStats(sets, exercises),
    sessions: decomposeSessions(sessions, sets, exercises).slice(0, 30),
  })
}
