import { eq, and, or, desc } from 'drizzle-orm'
import type { getDb } from '../client'
import * as s from '../schema'
import type { Friendship, Season } from '@trainingai/shared/types/friends'

type Db = ReturnType<typeof getDb>

// ── Row Mappers ────────────────────────────────────────────────────────────────

function rowToFriendship(
  r: typeof s.friendships.$inferSelect,
  otherRow: typeof s.users.$inferSelect,
): Friendship {
  return {
    id: r.id,
    requesterId: r.requesterId,
    addresseeId: r.addresseeId,
    status: r.status as 'pending' | 'accepted',
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    otherUser: {
      id: otherRow.id,
      displayName: otherRow.displayName,
      name: otherRow.name,
      avatar: otherRow.avatar,
      friendCode: otherRow.friendCode,
      equippedTitle: otherRow.equippedTitle,
    },
  }
}

// ── Friends ────────────────────────────────────────────────────────────────────

export async function listFriendships(db: Db, userId: string): Promise<Friendship[]> {
  const rows = await db
    .select({ f: s.friendships, u: s.users })
    .from(s.friendships)
    .innerJoin(s.users, or(
      and(eq(s.friendships.requesterId, userId), eq(s.users.id, s.friendships.addresseeId)),
      and(eq(s.friendships.addresseeId, userId), eq(s.users.id, s.friendships.requesterId)),
    ))
    .where(or(eq(s.friendships.requesterId, userId), eq(s.friendships.addresseeId, userId)))
  return rows.map(({ f, u }) => rowToFriendship(f, u))
}

export async function sendFriendRequest(db: Db, requesterId: string, emailOrCode: string): Promise<Friendship> {
  const upper = emailOrCode.toUpperCase()
  const [target] = await db.select().from(s.users)
    .where(or(eq(s.users.email, emailOrCode), eq(s.users.friendCode, upper)))
    .limit(1)
  if (!target) throw new Error('User not found')
  if (target.id === requesterId) throw new Error('Cannot add yourself')
  const [f] = await db.insert(s.friendships)
    .values({ requesterId, addresseeId: target.id, status: 'pending' })
    .onConflictDoNothing()
    .returning()
  if (!f) throw new Error('Friend request already exists')
  return rowToFriendship(f, target)
}

export async function acceptFriendRequest(db: Db, friendshipId: string, userId: string): Promise<Friendship> {
  const [f] = await db.update(s.friendships)
    .set({ status: 'accepted', updatedAt: new Date() })
    .where(and(eq(s.friendships.id, friendshipId), eq(s.friendships.addresseeId, userId), eq(s.friendships.status, 'pending')))
    .returning()
  if (!f) throw new Error('Request not found')
  const [other] = await db.select().from(s.users).where(eq(s.users.id, f.requesterId)).limit(1)
  return rowToFriendship(f, other)
}

export async function declineFriendRequest(db: Db, friendshipId: string, userId: string): Promise<void> {
  await db.delete(s.friendships)
    .where(and(eq(s.friendships.id, friendshipId), eq(s.friendships.addresseeId, userId), eq(s.friendships.status, 'pending')))
}

export async function removeFriend(db: Db, friendshipId: string, userId: string): Promise<void> {
  await db.delete(s.friendships)
    .where(and(
      eq(s.friendships.id, friendshipId),
      or(eq(s.friendships.requesterId, userId), eq(s.friendships.addresseeId, userId)),
    ))
}

export async function getFriendIds(db: Db, userId: string): Promise<string[]> {
  const rows = await db.select({
    requesterId: s.friendships.requesterId,
    addresseeId: s.friendships.addresseeId,
  }).from(s.friendships)
    .where(and(
      eq(s.friendships.status, 'accepted'),
      or(eq(s.friendships.requesterId, userId), eq(s.friendships.addresseeId, userId)),
    ))
  return rows.map(r => r.requesterId === userId ? r.addresseeId : r.requesterId)
}

export async function updateEquippedTitle(db: Db, userId: string, titleId: string | null): Promise<void> {
  await db.update(s.users).set({ equippedTitle: titleId }).where(eq(s.users.id, userId))
}

// ── Seasons ────────────────────────────────────────────────────────────────────

export async function listSeasonsWithResults(db: Db, userId: string): Promise<Season[]> {
  const seasonRows = await db.select().from(s.seasons).orderBy(desc(s.seasons.startDate))
  const resultRows = await db.select().from(s.seasonResults).where(eq(s.seasonResults.userId, userId))
  const resultMap = new Map(resultRows.map(r => [r.seasonId, r]))
  return seasonRows.map(season => {
    const result = resultMap.get(season.id)
    return {
      id: season.id,
      label: season.label,
      startDate: season.startDate,
      endDate: season.endDate,
      result: result ? {
        rank: result.rank,
        sessions: result.sessions,
        volumeKg: result.volumeKg,
        badgeLabel: result.badgeLabel as 'Gold' | 'Silver' | 'Bronze',
      } : undefined,
    }
  })
}
