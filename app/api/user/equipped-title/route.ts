import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getRepositoryAsync } from '@/lib/data'
import { TITLES } from '@trainingai/shared/types/friends'
import { readJsonLimited } from '@trainingai/shared/http/request-guards'
import { computeAchievements } from '@/lib/achievements'
import { DEFAULT_TZ } from '@trainingai/shared/date-utils'

// One title id.
const MAX_BODY_BYTES = 4 * 1024

export async function PATCH(req: Request) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const read = await readJsonLimited(req, MAX_BODY_BYTES)
  if (!read.ok) {
    return read.reason === 'too_large'
      ? NextResponse.json({ error: 'Request too large' }, { status: 413 })
      : NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  const { titleId } = (read.body ?? {}) as { titleId?: unknown }
  // `hasOwnProperty`, not `TITLES[titleId]`: the catalogue is a plain object literal, so a bare
  // lookup reaches Object.prototype and `constructor`, `toString`, `valueOf`, `__proto__` and four
  // more siblings all read as truthy — eight ids that passed this guard, got stored, and then failed
  // to render. `profile-tab.tsx` mounts `<title.Icon />` from the same map, and
  // `(Object).Icon` is undefined, which React answers with a hard "element type is invalid" crash.
  // The stored value survives a reload, so the profile tab stays white until the row is edited.
  const known = typeof titleId === 'string' && Object.prototype.hasOwnProperty.call(TITLES, titleId)
  if (titleId !== null && !known) {
    return NextResponse.json({ error: 'Invalid title' }, { status: 400 })
  }
  // The catalogue check above says the id is real; it says nothing about whether this user earned
  // it. The picker filters the list by `unlockedAchievementIds`, but that is the client's copy of a
  // rule only the server can hold — a direct PATCH skips it, and the equipped title renders on the
  // leaderboard, the feed and the public profile. `computeAchievements` is the one implementation of
  // unlock state (the profile route and /api/achievements both read it), so this asks it rather than
  // re-deriving a second answer that could disagree.
  if (typeof titleId === 'string') {
    const { achievements } = await computeAchievements(
      session.user.id, session.user.timezone ?? DEFAULT_TZ,
    )
    const requirement = TITLES[titleId].unlockedBy
    if (!achievements.some(a => a.id === requirement && a.unlocked)) {
      return NextResponse.json({ error: 'Title not unlocked' }, { status: 403 })
    }
  }
  const repo = await getRepositoryAsync()
  await repo.updateEquippedTitle(session.user.id, titleId)
  return NextResponse.json({ equippedTitle: titleId })
}
