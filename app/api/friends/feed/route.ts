import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getRepositoryAsync } from '@/lib/data'
import { getDb } from '@/lib/data/postgres/client'
import * as s from '@/lib/data/postgres/schema'
import { inArray, desc, and, isNull } from 'drizzle-orm'
import type { FeedEvent, FeedResponse, FeedUser } from '@trainingai/shared/types/friends'
import { rateLimit } from '@/lib/rate-limit'
import { profileDisplayName } from '@trainingai/shared/greeting'

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!rateLimit(`friends-feed:${session.user.id}`, 30, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  const repo = await getRepositoryAsync()
  const friendIds = await repo.getFriendIds(session.user.id)

  if (friendIds.length === 0) return NextResponse.json({ events: [], users: {} } satisfies FeedResponse, { headers: { 'Cache-Control': 'private, no-store' } })

  const db = getDb()

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
      displayName: profileDisplayName(user) ?? 'Unknown',
      // The avatar is sent once per friend in `users`, not on every event.
      avatar: null,
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
      displayName: profileDisplayName(user) ?? 'Unknown',
      // The avatar is sent once per friend in `users`, not on every event.
      avatar: null,
      equippedTitle: user.equippedTitle,
      payload: { achievementName: 'Workout completed' },
      occurredAt: ws.completedAt.toISOString(),
    })
  }

  events.sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime())

  const kept = events.slice(0, 50)
  // Each friend once, keyed by id, and only those the kept events name — an avatar is a data URI
  // and repeating it on every event multiplied the response by the number of events.
  const users: Record<string, FeedUser> = {}
  for (const e of kept) {
    if (users[e.userId]) continue
    const u = userMap.get(e.userId)!
    users[e.userId] = { displayName: e.displayName, avatar: u.avatar, equippedTitle: u.equippedTitle }
  }

  return NextResponse.json({ events: kept, users } satisfies FeedResponse, { headers: { "Cache-Control": "private, no-store" } })
}
