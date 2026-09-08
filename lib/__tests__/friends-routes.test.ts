/**
 * PS-39 — the social graph: `friends`, `friends/[id]`, `friends/feed` and `profile/[userId]`.
 *
 * Batched because they are the one place in this app where **one user's data can reach another**,
 * and they verify as a set: a friendship is created by the first, accepted by the second, and is
 * the only thing that unlocks the other two. Everything else in the app is single-user, so an
 * ownership slip elsewhere shows the caller their own data; a slip here shows them someone else's.
 *
 * The invariants that carry that weight:
 *
 *   · **`profile/[userId]` refuses a non-friend BEFORE it reads anything.** The friendship check is
 *     the entire boundary — there is no row-level filter behind it, the queries take the requested
 *     `userId` verbatim. It must 403 without touching the database.
 *   · **The response is an explicit field list, not the user row.** `db.select()` fetches the whole
 *     `users` row — email and every auth column with it — and only the named fields are returned.
 *   · **`friends/feed` scopes to the caller's own friend ids**, and short-circuits to an empty feed
 *     without querying at all when there are none.
 *   · **A friend request is rate-limited because the 201/400 split is an email-enumeration oracle** —
 *     the route's own comment says so, which makes the limit a security control rather than a
 *     courtesy.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NotFoundError, UserFacingError } from '@trainingai/shared/errors'

type Row = Record<string, unknown>

const listFriendships = vi.fn(async (_u: string) => [] as Row[])
const sendFriendRequest = vi.fn(async (_u: string, _t: string) => ({ id: 'fr-1', status: 'pending' }) as Row)
const acceptFriendRequest = vi.fn(async (_id: string, _u: string) => ({ id: 'fr-1', status: 'accepted' }) as Row)
const declineFriendRequest = vi.fn(async (_id: string, _u: string) => undefined)
const removeFriend = vi.fn(async (_id: string, _u: string) => undefined)
const getFriendIds = vi.fn(async (_u: string) => [] as string[])
const reportServerError = vi.fn()
const computeAchievements = vi.fn(async (_u: string, _tz: string) => achievements() as Row)

/** A chainable drizzle stub. Each `db.select(...)` consumes the next queued result, so a route
 *  making three queries in a Promise.all gets them in the order it wrote them. */
let dbResults: unknown[] = []
const dbSelect = vi.fn()
const dbExecute = vi.fn(async () => ({ rows: [{ total: 0 }] }))
const makeChain = () => {
  const result = dbResults.shift() ?? []
  const chain: Record<string, unknown> = {}
  for (const m of ['from', 'where', 'orderBy', 'limit', 'groupBy', 'innerJoin', 'leftJoin']) {
    chain[m] = () => chain
  }
  // Awaiting the builder is what runs it — drizzle's builders are thenables.
  chain.then = (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve)
  return chain
}

let sessionUser: { id: string; timezone?: string } | null = { id: 'u-me', timezone: 'Australia/Brisbane' }
vi.mock('@/auth', () => ({ auth: async () => (sessionUser ? { user: sessionUser } : null) }))
vi.mock('@/lib/data', () => {
  // Built inside the returned function: `vi.mock` is hoisted above the consts above.
  const repo = async () => ({
    listFriendships, sendFriendRequest, acceptFriendRequest, declineFriendRequest,
    removeFriend, getFriendIds,
  })
  return { getRepository: repo, getRepositoryAsync: repo }
})
vi.mock('@/lib/data/postgres/client', () => ({
  getDb: () => ({ select: (...a: unknown[]) => dbSelect(...a), execute: () => dbExecute() }),
}))
vi.mock('@/lib/achievements', () => ({
  computeAchievements: (u: string, tz: string) => computeAchievements(u, tz),
}))
vi.mock('@/lib/observability', () => ({ reportServerError: (...a: unknown[]) => reportServerError(...a) }))

import { GET as listFriends, POST as requestFriend } from '@/app/api/friends/route'
import { PATCH as respondToRequest, DELETE as unfriend } from '@/app/api/friends/[id]/route'
import { GET as friendsFeed } from '@/app/api/friends/feed/route'
import { GET as friendProfile } from '@/app/api/profile/[userId]/route'

const ME = '00000000-0000-4000-8000-00000000000a'
const FRIEND = '00000000-0000-4000-8000-00000000000b'
const STRANGER = '00000000-0000-4000-8000-00000000000c'
const REQUEST_ID = '00000000-0000-4000-8000-0000000000f1'

const achievements = (over: Row = {}) => ({
  level: 7, levelLabel: 'Strong', xp: 1200, currentLevelXp: 200, nextLevelXp: 500,
  lifetimeStats: { sessions: 42, totalVolumeKg: 90000, bestStreak: 9 },
  achievements: [
    { id: 'first-lift', unlocked: true, xpReward: 10 },
    { id: 'century', unlocked: true, xpReward: 100 },
    { id: 'iron-will', unlocked: true, xpReward: 50 },
    { id: 'marathon', unlocked: false, xpReward: 500 },
  ],
  ...over,
})

/** The whole `users` row the profile route selects — including what must never be returned. */
const userRow = (over: Row = {}) => ({
  id: FRIEND, displayName: 'Sam', name: 'Sam Smith', avatar: 'a.png',
  friendCode: 'ABC123', equippedTitle: 'Lifter',
  email: 'sam@private.example', passwordHash: '$2b$never', timezone: 'Europe/Berlin',
  dateOfBirth: '1990-01-01', ...over,
})

const post = (body: unknown) =>
  requestFriend(new Request('http://localhost/api/friends', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }) as never)
const patch = (body: unknown, id = REQUEST_ID) =>
  respondToRequest(new Request(`http://localhost/api/friends/${id}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }) as never, { params: Promise.resolve({ id }) } as never)
const del = (id = REQUEST_ID) =>
  unfriend(new Request(`http://localhost/api/friends/${id}`, { method: 'DELETE' }) as never,
    { params: Promise.resolve({ id }) } as never)
const profile = (userId: string) =>
  friendProfile(new Request(`http://localhost/api/profile/${userId}`) as never,
    { params: Promise.resolve({ userId }) } as never)

let seq = 0
const freshUser = () => { sessionUser = { id: `${ME}-${++seq}`, timezone: 'Australia/Brisbane' } }

beforeEach(() => {
  vi.clearAllMocks()
  sessionUser = { id: ME, timezone: 'Australia/Brisbane' }
  listFriendships.mockResolvedValue([])
  sendFriendRequest.mockResolvedValue({ id: 'fr-1', status: 'pending' })
  acceptFriendRequest.mockResolvedValue({ id: 'fr-1', status: 'accepted' })
  getFriendIds.mockResolvedValue([])
  computeAchievements.mockResolvedValue(achievements())
  dbResults = []
  dbSelect.mockImplementation(() => makeChain())
  dbExecute.mockResolvedValue({ rows: [{ total: 0 }] })
})

describe('GET/POST /api/friends', () => {
  it('refuses both verbs without a session', async () => {
    sessionUser = null
    expect((await listFriends()).status).toBe(401)
    expect((await post({ emailOrCode: 'a@b.c' })).status).toBe(401)
  })

  it('lists only the caller\'s own friendships, uncacheable', async () => {
    listFriendships.mockResolvedValue([{ id: 'f1', status: 'accepted' }])
    const res = await listFriends()
    expect(listFriendships).toHaveBeenCalledWith(ME)
    expect((await res.json()).friendships).toHaveLength(1)
    expect(res.headers.get('Cache-Control')).toBe('private, no-store')
  })

  it('requires an emailOrCode string and trims it', async () => {
    expect((await post({})).status).toBe(400)
    expect((await post({ emailOrCode: 42 })).status).toBe(400)
    expect((await post({ emailOrCode: '' })).status).toBe(400)
    expect(sendFriendRequest).not.toHaveBeenCalled()

    expect((await post({ emailOrCode: '  sam@example.com  ' })).status).toBe(201)
    expect(sendFriendRequest).toHaveBeenCalledWith(ME, 'sam@example.com')
  })

  it('refuses an oversized body', async () => {
    expect((await post({ emailOrCode: 'x'.repeat(8 * 1024) })).status).toBe(413)
    expect(sendFriendRequest).not.toHaveBeenCalled()
  })

  // The route's own comment: the 201/400 split lets an account be used to enumerate registered
  // emails. The limit is the control, so its number is load-bearing rather than a courtesy.
  it('rate-limits the eleventh request in the window, because the split is an enumeration oracle', async () => {
    freshUser()  // its own budget: the cases above already spent some of the default user's
    for (let i = 0; i < 10; i++) expect((await post({ emailOrCode: `p${i}@x.co` })).status).toBe(201)
    const res = await post({ emailOrCode: 'p10@x.co' })
    expect(res.status).toBe(429)
    expect(sendFriendRequest).toHaveBeenCalledTimes(10)
  })

  it('echoes a refusal without recording it as a server fault', async () => {
    freshUser()
    sendFriendRequest.mockRejectedValue(new UserFacingError('Already friends', 409))
    const res = await post({ emailOrCode: 'sam@example.com' })
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'Already friends' })
    expect(reportServerError).not.toHaveBeenCalled()
  })

  it('hides an unexpected failure behind a generic message, and records it', async () => {
    freshUser()
    sendFriendRequest.mockRejectedValue(new Error('column "friend_code" does not exist'))
    const res = await post({ emailOrCode: 'sam@example.com' })
    expect(res.status).toBe(500)
    // The driver's text names a column and would otherwise reach the client.
    expect(await res.json()).toEqual({ error: 'Could not send that request' })
    expect(reportServerError).toHaveBeenCalledTimes(1)
  })
})

describe('PATCH/DELETE /api/friends/[id]', () => {
  it('refuses without a session and on a malformed id', async () => {
    sessionUser = null
    expect((await patch({ action: 'accept' })).status).toBe(401)
    expect((await del()).status).toBe(401)

    sessionUser = { id: ME }
    expect((await patch({ action: 'accept' }, 'not-a-uuid')).status).toBe(400)
    expect((await del('not-a-uuid')).status).toBe(400)
    expect(acceptFriendRequest).not.toHaveBeenCalled()
    expect(removeFriend).not.toHaveBeenCalled()
  })

  // The caller's id comes from the SESSION, never the body — it is what stops one user accepting
  // or deleting a friendship that is not theirs.
  it('acts on the request as the session user, not as anyone the body names', async () => {
    await patch({ action: 'accept', userId: STRANGER })
    expect(acceptFriendRequest).toHaveBeenCalledWith(REQUEST_ID, ME)

    await patch({ action: 'decline' })
    expect(declineFriendRequest).toHaveBeenCalledWith(REQUEST_ID, ME)

    await del()
    expect(removeFriend).toHaveBeenCalledWith(REQUEST_ID, ME)
  })

  it('answers 204 with no body for decline and remove', async () => {
    const declined = await patch({ action: 'decline' })
    expect(declined.status).toBe(204)
    expect(await declined.text()).toBe('')
    expect((await del()).status).toBe(204)
  })

  it('rejects an unknown action without touching the repository', async () => {
    for (const action of ['block', '', undefined, 7]) {
      const res = await patch({ action })
      expect(res.status).toBe(400)
      expect(await res.json()).toEqual({ error: 'Invalid action' })
    }
    expect(acceptFriendRequest).not.toHaveBeenCalled()
    expect(declineFriendRequest).not.toHaveBeenCalled()
  })

  it('turns a repository refusal into its own status, not a 500', async () => {
    acceptFriendRequest.mockRejectedValue(new NotFoundError('Friend request'))
    const res = await patch({ action: 'accept' })
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'Friend request not found' })
    expect(reportServerError).not.toHaveBeenCalled()
  })
})

describe('GET /api/friends/feed', () => {
  it('refuses without a session', async () => {
    sessionUser = null
    expect((await friendsFeed()).status).toBe(401)
  })

  it('answers an empty feed without querying at all when there are no friends', async () => {
    const res = await friendsFeed()
    expect(await res.json()).toEqual({ events: [] })
    expect(dbSelect).not.toHaveBeenCalled()
    expect(res.headers.get('Cache-Control')).toBe('private, no-store')
  })

  it('builds the feed from the caller\'s own friend ids', async () => {
    getFriendIds.mockResolvedValue([FRIEND])
    const now = new Date('2026-09-08T10:00:00Z')
    const earlier = new Date('2026-09-07T10:00:00Z')
    dbResults = [
      [{ userId: FRIEND, exerciseName: 'Squat', estimated1rm: 140, achievedAt: earlier }],
      [{ userId: FRIEND, startedAt: now, completedAt: now }],
      [{ id: FRIEND, displayName: 'Sam', name: 'Sam Smith', avatar: 'a.png', equippedTitle: 'Lifter' }],
    ]
    const body = await (await friendsFeed()).json()
    expect(getFriendIds).toHaveBeenCalledWith(ME)
    // Newest first: the completed session outranks the earlier PR.
    expect(body.events.map((e: Row) => e.type)).toEqual(['achievement', 'pr'])
    expect(body.events[1]).toMatchObject({
      userId: FRIEND, displayName: 'Sam', payload: { exerciseName: 'Squat', weightKg: 140 },
    })
  })

  it('drops an event whose author is not in the friend set', async () => {
    // The rows and the user lookup are separate queries; a row for someone the second did not
    // return must not become an event attributed to "Unknown".
    getFriendIds.mockResolvedValue([FRIEND])
    dbResults = [
      [{ userId: STRANGER, exerciseName: 'Deadlift', estimated1rm: 200, achievedAt: new Date() }],
      [],
      [{ id: FRIEND, displayName: 'Sam', name: 'Sam Smith', avatar: null, equippedTitle: null }],
    ]
    expect((await (await friendsFeed()).json()).events).toEqual([])
  })

  it('omits a session that was started but never completed', async () => {
    getFriendIds.mockResolvedValue([FRIEND])
    dbResults = [
      [],
      [{ userId: FRIEND, startedAt: new Date(), completedAt: null }],
      [{ id: FRIEND, displayName: 'Sam', name: null, avatar: null, equippedTitle: null }],
    ]
    expect((await (await friendsFeed()).json()).events).toEqual([])
  })
})

describe('GET /api/profile/[userId]', () => {
  it('refuses without a session and on a malformed id', async () => {
    sessionUser = null
    expect((await profile(FRIEND)).status).toBe(401)

    sessionUser = { id: ME }
    expect((await profile('not-a-uuid')).status).toBe(400)
    expect(getFriendIds).not.toHaveBeenCalled()
  })

  // The entire boundary. There is no row-level filter behind this check — the queries below take
  // the requested userId verbatim — so it must refuse before any of them run.
  it('403s a stranger before reading anything', async () => {
    getFriendIds.mockResolvedValue([FRIEND])
    const res = await profile(STRANGER)
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'Not a friend' })
    expect(dbSelect).not.toHaveBeenCalled()
    expect(dbExecute).not.toHaveBeenCalled()
    expect(computeAchievements).not.toHaveBeenCalled()
  })

  it('lets a friend through, and lets the caller read their own profile without a friendship', async () => {
    getFriendIds.mockResolvedValue([FRIEND])
    dbResults = [[userRow()]]
    expect((await profile(FRIEND)).status).toBe(200)

    // Self: the friend lookup is skipped entirely.
    getFriendIds.mockClear()
    dbResults = [[userRow({ id: ME })]]
    expect((await profile(ME)).status).toBe(200)
    expect(getFriendIds).not.toHaveBeenCalled()
  })

  // `db.select()` fetches the whole users row. Only the named fields may come back.
  it('returns a field list, never the user row it read', async () => {
    getFriendIds.mockResolvedValue([FRIEND])
    dbResults = [[userRow()]]
    const body = await (await profile(FRIEND)).json()
    expect(body.displayName).toBe('Sam')
    expect(body.friendCode).toBe('ABC123')
    expect(body).not.toHaveProperty('email')
    expect(body).not.toHaveProperty('passwordHash')
    expect(body).not.toHaveProperty('timezone')
    expect(body).not.toHaveProperty('dateOfBirth')
    expect(JSON.stringify(body)).not.toContain('sam@private.example')
  })

  it('404s a friend id with no user row behind it', async () => {
    getFriendIds.mockResolvedValue([FRIEND])
    dbResults = [[]]
    expect((await profile(FRIEND)).status).toBe(404)
  })

  it('shows the three highest-value unlocked achievements as the trophy case', async () => {
    getFriendIds.mockResolvedValue([FRIEND])
    dbResults = [[userRow()]]
    const body = await (await profile(FRIEND)).json()
    // century 100 > iron-will 50 > first-lift 10; marathon is locked and cannot appear.
    expect(body.trophyCase).toEqual(['century', 'iron-will', 'first-lift'])
    expect(body.unlockedAchievementIds).not.toContain('marathon')
  })

  it('computes achievements for the profile being viewed, in the VIEWER\'s timezone', async () => {
    // The viewer reads the page, so the day boundaries are theirs — the subject's stored timezone
    // is in the row above and must not be the one used.
    sessionUser = { id: ME, timezone: 'America/New_York' }
    getFriendIds.mockResolvedValue([FRIEND])
    dbResults = [[userRow()]]
    await profile(FRIEND)
    expect(computeAchievements).toHaveBeenCalledWith(FRIEND, 'America/New_York')
  })

  it('answers no-store, because a friend\'s stats are not shared-cacheable', async () => {
    getFriendIds.mockResolvedValue([FRIEND])
    dbResults = [[userRow()]]
    expect((await profile(FRIEND)).headers.get('Cache-Control')).toBe('private, no-store')
  })
})
