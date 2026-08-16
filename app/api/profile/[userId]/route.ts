import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getRepositoryAsync } from '@/lib/data'
import { getDb } from '@/lib/data/postgres/client'
import { sql, eq } from 'drizzle-orm'
import * as s from '@/lib/data/postgres/schema'
import { computeAchievements } from '@/lib/achievements'
import { DEFAULT_TZ } from '@trainingai/shared/date-utils'

export async function GET(_req: Request, { params }: { params: Promise<{ userId: string }> }) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { userId } = await params
  const repo = await getRepositoryAsync()

  // Verify friendship (or self)
  if (userId !== session.user.id) {
    const friendIds = await repo.getFriendIds(session.user.id)
    if (!friendIds.includes(userId)) {
      return NextResponse.json({ error: 'Not a friend' }, { status: 403 })
    }
  }

  const db = getDb()
  const tz = session.user.timezone ?? DEFAULT_TZ

  const [userRow, distanceRes, achievementsResult] = await Promise.all([
    db.select().from(s.users).where(eq(s.users.id, userId)).limit(1),
    db.execute(sql`
      SELECT COALESCE(SUM(distance_km), 0)::float AS total
      FROM activity_logs
      WHERE user_id = ${userId}::uuid
    `),
    computeAchievements(userId, tz),
  ])

  const user = userRow[0]
  if (!user) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const totalDistanceKm = Number((distanceRes.rows[0] as { total: number })?.total ?? 0)

  const unlocked = achievementsResult.achievements.filter(a => a.unlocked)
  const unlockedAchievementIds = unlocked.map(a => a.id)
  const trophyCase = unlocked
    .slice()
    .sort((a, b) => b.xpReward - a.xpReward)
    .slice(0, 3)
    .map(a => a.id)

  return NextResponse.json({
    id: user.id,
    displayName: user.displayName,
    name: user.name,
    avatar: user.avatar,
    friendCode: user.friendCode,
    equippedTitle: user.equippedTitle,
    level: achievementsResult.level,
    levelLabel: achievementsResult.levelLabel,
    xp: achievementsResult.xp,
    currentLevelXp: achievementsResult.currentLevelXp,
    nextLevelXp: achievementsResult.nextLevelXp,
    lifetimeSessions: achievementsResult.lifetimeStats.sessions,
    lifetimeVolumeKg: achievementsResult.lifetimeStats.totalVolumeKg,
    bestStreak: achievementsResult.lifetimeStats.bestStreak,
    totalDistanceKm,
    trophyCase,
    unlockedAchievementIds,
    achievements: achievementsResult.achievements,
  }, { headers: { 'Cache-Control': 'private, no-store' } })
}
