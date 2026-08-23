import { NextResponse } from 'next/server'
import { and, eq, gt } from 'drizzle-orm'
import { auth } from '@/auth'
import { getDb, ensureSchema } from '@/lib/data/postgres/client'
import * as s from '@/lib/data/postgres/schema'
import { rateLimit } from '@/lib/rate-limit'
import { undoCoachChange } from '@/lib/coach/apply'
import { invalidateProgramStructure } from '@/lib/cache-groups'
import { errorLog } from '@trainingai/shared/logger'
import { invalidUuidResponse } from '@/lib/api/route-errors'

/**
 * Undo a change AI Coach applied.
 *
 * The window is **until the next workout started after the change**, not a clock (owner decision).
 * A time-based window is arbitrary — an hour is too short if you applied it at night, too long if
 * you trained ten minutes later. What actually matters is whether the change has already shaped a
 * session: once it has, reversing it would silently disagree with a workout you have already done.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (!rateLimit(`${userId}:coach-undo`, 20, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  const { id } = await params
  const badId = invalidUuidResponse(id)
  if (badId) return badId

  try {
    await ensureSchema()
    const db = getDb()

    const [record] = await db
      .select({ appliedAt: s.coachChanges.appliedAt, undoneAt: s.coachChanges.undoneAt })
      .from(s.coachChanges)
      .where(and(eq(s.coachChanges.id, id), eq(s.coachChanges.userId, userId)))
      .limit(1)
    if (!record) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    if (record.undoneAt) return NextResponse.json({ error: 'Already undone' }, { status: 400 })

    const [trained] = await db
      .select({ id: s.workoutSessions.id })
      .from(s.workoutSessions)
      .where(and(eq(s.workoutSessions.userId, userId), gt(s.workoutSessions.startedAt, record.appliedAt)))
      .limit(1)
    if (trained) {
      return NextResponse.json(
        { error: "You've trained since this change — undoing it now would disagree with a session you've already done." },
        { status: 409 },
      )
    }

    const result = await undoCoachChange(db, userId, id)
    if (!result.ok) {
      if (result.reason === 'not_found') return NextResponse.json({ error: 'Not found' }, { status: 404 })
      if (result.reason === 'stale') {
        // 409, the same as apply: the request was well-formed, the target moved. Usually because a
        // later Coach change is still in effect over this one — undo that first (Q-468).
        return NextResponse.json(
          { error: 'This change is no longer the one in effect — undo the later change first', drift: result.drift },
          { status: 409 },
        )
      }
      const detail = result.reason === 'invalid' ? result.detail : 'This change can no longer be undone'
      return NextResponse.json({ error: detail }, { status: 400 })
    }

    await invalidateProgramStructure()
    return NextResponse.json({ summary: result.summary })
  } catch (error) {
    errorLog(error, 'API /coach/apply/undo')
    return NextResponse.json({ error: 'Undo failed' }, { status: 500 })
  }
}
