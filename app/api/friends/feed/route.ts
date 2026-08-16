import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getRepositoryAsync } from '@/lib/data'
import { getDb } from '@/lib/data/postgres/client'
import * as s from '@/lib/data/postgres/schema'
import { inArray, desc, gte, and, isNull } from 'drizzle-orm'
import type { FeedEvent } from '@trainingai/shared/types/friends'

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const repo = await getRepositoryAsync()
  const friendIds = await repo.getFriendIds(session.user.id)

  if (friendIds.length === 0) return NextResponse.json({ events: [] }, { headers: { 'Cache-Control': 'private, no-store' } })

  const db = getDb()
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)

  const [prRows, sessionRows, friendRows] = await Promise.all([
    db.select({
      userId: s.personalRecords.userId,
      exerciseName: s.personalRecords.exerciseName,
      estimated1rm: s.personalRecords.estimated1rm,
      achievedAt: s.personalRecords.achievedAt,
    }).from(s.personalRecords)
      .where(inArray(s.personalRecords.userId, friendIds))
      .orderBy(desc(s.personalRecords.achievedAt))
      .limit(50),

    db.select({
      userId: s.workoutSessions.userId,
      startedAt: s.workoutSessions.startedAt,
      completedAt: s.workoutSessions.completedAt,
    }).from(s.workoutSessions)
      .where(and(inArray(s.workoutSessions.userId, friendIds), isNull(s.workoutSessions.deletedAt)))
      .orderBy(desc(s.workoutSessions.startedAt))
      .limit(50),

    db.select({
      id: s.users.id,
      displayName: s.users.displayName,
      name: s.users.name,
      avatar: s.users.avatar,
      equippedTitle: s.users.equippedTitle,
    }).from(s.users).where(inArray(s.users.id, friendIds)),
  ])

  const userMap = new Map(friendRows.map(u => [u.id, u]))

  const events: FeedEvent[] = []

  for (const pr of prRows) {
    const user = userMap.get(pr.userId)
    if (!user) continue
    events.push({
      type: 'pr',
      userId: pr.userId,
      displayName: user.displayName ?? user.name ?? 'Unknown',
      avatar: user.avatar,
      equippedTitle: user.equippedTitle,
      payload: { exerciseName: pr.exerciseName, weightKg: pr.estimated1rm },
      occurredAt: pr.achievedAt.toISOString(),
    })
  }

  for (const ws of sessionRows) {
    const user = userMap.get(ws.userId)
    if (!user || !ws.completedAt) continue
    events.push({
      type: 'achievement',
      userId: ws.userId,
      displayName: user.displayName ?? user.name ?? 'Unknown',
      avatar: user.avatar,
      equippedTitle: user.equippedTitle,
      payload: { achievementName: 'Workout completed' },
      occurredAt: ws.completedAt.toISOString(),
    })
  }

  events.sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime())

  return NextResponse.json({ events: events.slice(0, 50) }, { headers: { "Cache-Control": "private, no-store" } })
}
