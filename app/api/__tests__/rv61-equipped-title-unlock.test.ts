/**
 * RV-61 — the equipped title is gated on the CATALOGUE, not on whether the user earned it.
 *
 * `PATCH /api/user/equipped-title` checked only that the id existed in `TITLES`. The picker sheet
 * filters the list by `unlockedAchievementIds`, but that is the client's copy of a rule only the
 * server can hold: a direct PATCH skipped it, and the stored value renders on the friend
 * leaderboard, the friend feed and the public profile page.
 *
 * The distinction these cases hold is between the two things a title id means. `iron_will` is a
 * catalogue key; `streak_60` is the achievement that unlocks it. The check reads `unlockedBy`, so
 * an implementation that compared the achievement id against the TITLE id would pass the obvious
 * case and fail every real one — which is why both directions are here.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

type Row = Record<string, unknown>

const updateEquippedTitle = vi.fn(async (_u: string, _t: string | null) => undefined)
const computeAchievements = vi.fn(async (_u: string, _tz: string) => ({ achievements: [] }) as Row)

let sessionUser: { id: string; timezone?: string } | null = null
vi.mock('@/auth', () => ({ auth: async () => (sessionUser ? { user: sessionUser } : null) }))
vi.mock('@/lib/data', () => {
  const repo = async () => ({ updateEquippedTitle })
  return { getRepository: repo, getRepositoryAsync: repo }
})
vi.mock('@/lib/achievements', () => ({
  computeAchievements: (u: string, tz: string) => computeAchievements(u, tz),
}))

import { PATCH } from '@/app/api/user/equipped-title/route'

const ME = '00000000-0000-4000-8000-00000000000a'

/** `iron_will` is unlocked by `streak_60`; `unbroken` by `streak_30`. */
const unlocked = (...ids: string[]) => ({
  achievements: [
    { id: 'streak_60', unlocked: ids.includes('streak_60') },
    { id: 'streak_30', unlocked: ids.includes('streak_30') },
    { id: 'sessions_100', unlocked: ids.includes('sessions_100') },
  ],
})

const patch = (body: unknown) =>
  PATCH(new Request('http://localhost/api/user/equipped-title', {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }) as never)

beforeEach(() => {
  vi.clearAllMocks()
  sessionUser = { id: ME, timezone: 'Australia/Brisbane' }
  computeAchievements.mockResolvedValue(unlocked())
})

describe('RV-61 — a title the caller has not unlocked is refused', () => {
  /** THE case. Review reproduced it live: a user at `bestStreak: 9` equipped `iron_will`
   *  (`unlockedBy: 'streak_60'`), got a 200, and read it back from Postgres as stored. */
  it('refuses a real catalogue title whose achievement is locked, and writes nothing', async () => {
    const res = await patch({ titleId: 'iron_will' })
    expect(res.status).toBe(403)
    expect(updateEquippedTitle).not.toHaveBeenCalled()
  })

  /** Present-but-locked and absent-entirely are different states and must both refuse. An
   *  implementation reading `achievements.find(...)!.unlocked` would throw on the second. */
  it('refuses when the unlocking achievement is absent from the computed list', async () => {
    computeAchievements.mockResolvedValue({ achievements: [{ id: 'sessions_100', unlocked: true }] })
    const res = await patch({ titleId: 'iron_will' })
    expect(res.status).toBe(403)
    expect(updateEquippedTitle).not.toHaveBeenCalled()
  })

  /** The deliberately equivalent control: a fix that simply refused every title would pass every
   *  case above. The feature has to keep working. */
  it('still equips a title the caller HAS unlocked', async () => {
    computeAchievements.mockResolvedValue(unlocked('streak_60'))
    const res = await patch({ titleId: 'iron_will' })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ equippedTitle: 'iron_will' })
    expect(updateEquippedTitle).toHaveBeenCalledWith(ME, 'iron_will')
  })

  /** The gate reads `TITLES[id].unlockedBy`, never the title id itself. Unlocking `streak_30`
   *  equips `unbroken` even though no achievement is called `unbroken`. */
  it('resolves the requirement through unlockedBy, not the title id', async () => {
    computeAchievements.mockResolvedValue(unlocked('streak_30'))
    const res = await patch({ titleId: 'unbroken' })
    expect(res.status).toBe(200)
    expect(updateEquippedTitle).toHaveBeenCalledWith(ME, 'unbroken')
  })

  /** The mirror, which is what an id-vs-id implementation would get wrong: an achievement that
   *  happens to share the title's name unlocks nothing. */
  it('is not satisfied by an unlocked achievement that merely shares the title id', async () => {
    computeAchievements.mockResolvedValue({ achievements: [{ id: 'unbroken', unlocked: true }] })
    const res = await patch({ titleId: 'unbroken' })
    expect(res.status).toBe(403)
    expect(updateEquippedTitle).not.toHaveBeenCalled()
  })

  /** Unlock state is computed for the CALLER, from the session — there is no user id in the body
   *  to confuse it with, and the timezone matters because streaks are day-bucketed. */
  it('computes unlock state for the session user and timezone', async () => {
    computeAchievements.mockResolvedValue(unlocked('streak_60'))
    sessionUser = { id: ME, timezone: 'America/New_York' }
    await patch({ titleId: 'iron_will' })
    expect(computeAchievements).toHaveBeenCalledWith(ME, 'America/New_York')
  })
})

describe('RV-61 — what the new gate must NOT change', () => {
  /** Clearing a title is not a claim to have earned anything, so it must not be gated — and it
   *  must not pay for `computeAchievements`, which is fifteen queries and a reconcile write. */
  it('clears the title without consulting achievements at all', async () => {
    const res = await patch({ titleId: null })
    expect(res.status).toBe(200)
    expect(updateEquippedTitle).toHaveBeenCalledWith(ME, null)
    expect(computeAchievements).not.toHaveBeenCalled()
  })

  /** Regression guards for the guard this sits behind: an id outside the catalogue is still a 400,
   *  and still a 400 rather than the 403 — the two refusals mean different things. */
  it.each([['iron_will_x'], ['__proto__'], ['constructor'], ['toString']])(
    'still rejects %s with 400 before any unlock work', async (titleId) => {
      const res = await patch({ titleId })
      expect(res.status).toBe(400)
      expect(computeAchievements).not.toHaveBeenCalled()
      expect(updateEquippedTitle).not.toHaveBeenCalled()
    })

  it('still rejects an unauthenticated caller with 401', async () => {
    sessionUser = null
    const res = await patch({ titleId: 'iron_will' })
    expect(res.status).toBe(401)
    expect(computeAchievements).not.toHaveBeenCalled()
  })
})
