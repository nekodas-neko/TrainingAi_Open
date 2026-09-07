import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getRepositoryAsync } from '@/lib/data'
import { getDb } from '@/lib/data/postgres/client'
import * as s from '@/lib/data/postgres/schema'
import { inArray, eq, and, gte, sum, count, isNull } from 'drizzle-orm'
import { sql } from 'drizzle-orm'
import type { LeaderboardEntry } from '@trainingai/shared/types/friends'
import { DEFAULT_TZ } from '@trainingai/shared/date-utils'
import { computeStreak } from '@/lib/achievements'
import { maxCompliantRestGapFor } from '@trainingai/shared/schedule-utils'
import { longestWeeklyStreak } from '@trainingai/shared/workout/year-review'
import { startOfWeek, format } from 'date-fns'
import { toZonedTime } from 'date-fns-tz'

const STREAK_WINDOW_DAYS = 90

function getMondayUtc(tz: string): Date {
  const nowInTz = toZonedTime(new Date(), tz)
  const monday = startOfWeek(nowInTz, { weekStartsOn: 1 })
  return new Date(format(monday, "yyyy-MM-dd'T'00:00:00") + 'Z')
}

export async function GET(req: Request) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const tz = session.user.timezone ?? DEFAULT_TZ
  const repo = await getRepositoryAsync()
  const friendIds = await repo.getFriendIds(session.user.id)
  const allIds = [...friendIds, session.user.id]

  const db = getDb()
  const monday = getMondayUtc(tz)
  const streakFrom = new Date(Date.now() - STREAK_WINDOW_DAYS * 24 * 60 * 60 * 1000)

  const [userRows, weeklyRows, allTimeRows, streakRows, scheduleRows] = await Promise.all([
    db.select({
      id: s.users.id,
      displayName: s.users.displayName,
      name: s.users.name,
      avatar: s.users.avatar,
      equippedTitle: s.users.equippedTitle,
    }).from(s.users).where(inArray(s.users.id, allIds)),

    db.select({
      userId: s.workoutSessions.userId,
      sessions: count(s.workoutSessions.id),
      volumeKg: sql<number>`coalesce(sum(${s.setLogs.weightKg} * ${s.setLogs.reps}), 0)`.as('volumeKg'),
    }).from(s.workoutSessions)
      .leftJoin(s.exerciseLogs, and(eq(s.exerciseLogs.workoutSessionId, s.workoutSessions.id), isNull(s.exerciseLogs.deletedAt)))
      .leftJoin(s.setLogs, and(eq(s.setLogs.exerciseLogId, s.exerciseLogs.id), isNull(s.setLogs.deletedAt)))
      .where(and(inArray(s.workoutSessions.userId, allIds), gte(s.workoutSessions.startedAt, monday), isNull(s.workoutSessions.deletedAt)))
      .groupBy(s.workoutSessions.userId),

    db.select({
      userId: s.workoutSessions.userId,
      sessions: count(s.workoutSessions.id),
      volumeKg: sql<number>`coalesce(sum(${s.setLogs.weightKg} * ${s.setLogs.reps}), 0)`.as('volumeKg'),
    }).from(s.workoutSessions)
      .leftJoin(s.exerciseLogs, and(eq(s.exerciseLogs.workoutSessionId, s.workoutSessions.id), isNull(s.exerciseLogs.deletedAt)))
      .leftJoin(s.setLogs, and(eq(s.setLogs.exerciseLogId, s.exerciseLogs.id), isNull(s.setLogs.deletedAt)))
      .where(and(inArray(s.workoutSessions.userId, allIds), isNull(s.workoutSessions.deletedAt)))
      .groupBy(s.workoutSessions.userId),

    // Distinct trained days per user over the streak window (a "trained day" = a session with a
    // non-deleted exercise log, matching getRecentTrainedDays / the user's own streak card), as
    // 'YYYY-MM-DD' in the user's tz. Streaks are computed from these via the canonical helpers.
    db.selectDistinct({
      userId: s.workoutSessions.userId,
      day: sql<string>`to_char(${s.workoutSessions.startedAt} AT TIME ZONE ${tz}, 'YYYY-MM-DD')`,
    }).from(s.workoutSessions)
      .innerJoin(s.exerciseLogs, and(eq(s.exerciseLogs.workoutSessionId, s.workoutSessions.id), isNull(s.exerciseLogs.deletedAt)))
      .where(and(inArray(s.workoutSessions.userId, allIds), gte(s.workoutSessions.startedAt, streakFrom), isNull(s.workoutSessions.deletedAt))),

    // BF-122a — every user's active schedule in ONE query, so the streak's rest-day allowance is
    // read off their plan rather than hardcoded. Batched with `inArray` like every other query in
    // this block: a per-user fetch here would be an N+1 over the whole friends list.
    db.select({
      userId: s.programs.userId,
      type: s.schedules.type,
      restAfterN: s.schedules.restAfterN,
      dayOfWeek: s.scheduleDays.dayOfWeek,
      sessionId: s.scheduleDays.sessionId,
    }).from(s.programs)
      .innerJoin(s.schedules, eq(s.schedules.programId, s.programs.id))
      .leftJoin(s.scheduleDays, eq(s.scheduleDays.scheduleId, s.schedules.id))
      .where(and(inArray(s.programs.userId, allIds), eq(s.programs.isActive, true))),
  ])

  const weeklyMap = new Map(weeklyRows.map(r => [r.userId, r]))
  const allTimeMap = new Map(allTimeRows.map(r => [r.userId, r]))
  const daysByUser = new Map<string, string[]>()
  for (const r of streakRows) {
    const arr = daysByUser.get(r.userId)
    if (arr) arr.push(r.day)
    else daysByUser.set(r.userId, [r.day])
  }

  // BF-122a — one Schedule per user, rebuilt from the flat join above.
  const scheduleByUser = new Map<string, { type: 'rotation' | 'weekly'; restAfterN?: number; days: { dayOfWeek: number; sessionId?: string }[] }>()
  for (const r of scheduleRows) {
    let entry = scheduleByUser.get(r.userId)
    if (!entry) {
      entry = {
        type: r.type === 'weekly' ? 'weekly' : 'rotation',
        restAfterN: r.restAfterN ?? undefined,
        days: [],
      }
      scheduleByUser.set(r.userId, entry)
    }
    // A day with no session is a configured rest day — carried through rather than dropped, since
    // the helper is what decides that, not this loop.
    if (r.dayOfWeek != null) entry.days.push({ dayOfWeek: r.dayOfWeek, sessionId: r.sessionId ?? undefined })
  }

  const entries: LeaderboardEntry[] = userRows.map(u => {
    const w = weeklyMap.get(u.id)
    const a = allTimeMap.get(u.id)
    const days = daysByUser.get(u.id) ?? []
    return {
      userId: u.id,
      displayName: u.displayName ?? u.name ?? 'Unknown',
      avatar: u.avatar,
      equippedTitle: u.equippedTitle,
      isSelf: u.id === session.user.id,
      weeklySessions: w?.sessions ?? 0,
      weeklyVolumeKg: Number(w?.volumeKg ?? 0),
      // Best consecutive-week / consecutive-day training streaks (canonical helpers, One-Formula).
      weeklyStreak: longestWeeklyStreak(days),
      allTimeSessions: a?.sessions ?? 0,
      allTimeVolumeKg: Number(a?.volumeKg ?? 0),
      // BF-122a — the allowance comes from each user's own schedule. A literal 1 here was right
      // only for a rotation: someone training Mon+Tue is compliant across a five-day hole, and
      // their leaderboard streak broke every week.
      allTimeStreak: computeStreak(days, tz, maxCompliantRestGapFor(scheduleByUser.get(u.id))).best,
    }
  })

  return NextResponse.json({ entries }, { headers: { "Cache-Control": "private, no-store" } })
}
