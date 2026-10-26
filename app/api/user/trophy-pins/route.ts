import { NextResponse } from 'next/server'
import { z } from 'zod'
import { auth } from '@/auth'
import { getRepositoryAsync } from '@/lib/data'
import { rateLimit } from '@/lib/rate-limit'
import { computeAchievements } from '@/lib/achievements'
import { DEFAULT_TZ } from '@trainingai/shared/date-utils'
import { TROPHY_SLOTS } from '@trainingai/shared/achievement-display'
import { readJsonLimited } from '@trainingai/shared/http/request-guards'

const NO_STORE = { 'Cache-Control': 'private, no-store' }
// Three short ids.
const MAX_BODY_BYTES = 4 * 1024

const bodySchema = z.object({
  pins: z.array(z.string().min(1).max(64)).max(TROPHY_SLOTS)
    .refine(ids => new Set(ids).size === ids.length, 'Duplicate pin'),
}).strict()

/** The trophies this user pinned, in pin order; null when nothing is pinned. */
export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  // The trophy case reads this on every foreground; generous, but not unbounded.
  if (!rateLimit(`${session.user.id}:trophy-pins-read`, 120, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }
  const repo = await getRepositoryAsync()
  return NextResponse.json({ pins: await repo.getTrophyPins(session.user.id) }, { headers: NO_STORE })
}

/** Save the pins friends see. An empty list clears them, and friends go back to the top three by XP. */
export async function PUT(req: Request) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!rateLimit(`${session.user.id}:trophy-pins`, 30, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }
  const read = await readJsonLimited(req, MAX_BODY_BYTES)
  if (!read.ok) {
    return read.reason === 'too_large'
      ? NextResponse.json({ error: 'Request too large' }, { status: 413 })
      : NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  const parsed = bodySchema.safeParse(read.body)
  if (!parsed.success) return NextResponse.json({ error: 'Invalid pins' }, { status: 400 })
  const { pins } = parsed.data

  // A pin is what friends see, so only earned trophies may be shown. `computeAchievements` is the
  // one implementation of unlock state, the same one the profile route and the title route ask.
  if (pins.length > 0) {
    const { achievements } = await computeAchievements(session.user.id, session.user.timezone ?? DEFAULT_TZ)
    const unlocked = new Set(achievements.filter(a => a.unlocked).map(a => a.id))
    if (!pins.every(id => unlocked.has(id))) {
      return NextResponse.json({ error: 'Trophy not unlocked' }, { status: 403 })
    }
  }

  const repo = await getRepositoryAsync()
  const saved = await repo.updateTrophyPins(session.user.id, pins.length > 0 ? pins : null)
  if (!saved) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ pins: pins.length > 0 ? pins : null }, { headers: NO_STORE })
}
