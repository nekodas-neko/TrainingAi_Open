import { NextResponse } from 'next/server'
import { z } from 'zod'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'
import type { DietaryRestriction, UserDietaryRestriction } from '@trainingai/shared/types/nutrition'
import { readJsonLimited } from '@trainingai/shared/http/request-guards'

// A short list of restrictions.
const MAX_BODY_BYTES = 16 * 1024

export interface DietaryRestrictionsResponse {
  /** The seeded catalogue, for the searchable picker. Global — no personal data. */
  catalogue: DietaryRestriction[]
  /** This user's current selections. */
  mine: UserDietaryRestriction[]
}

const PutSchema = z.object({
  entries: z.array(z.object({
    restrictionId: z.string().uuid(),
    severity: z.enum(['avoid', 'allergy']),
  })).max(60),
})

export async function GET() {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const repo = await getRepository()
  const [catalogue, mine] = await Promise.all([
    repo.listDietaryRestrictions(),
    repo.listUserDietaryRestrictions(userId),
  ])
  return NextResponse.json<DietaryRestrictionsResponse>({ catalogue, mine }, {
    headers: { 'Cache-Control': 'private, no-store' },
  })
}

/** Replace the whole set — the picker already knows the complete desired state. */
export async function PUT(req: Request) {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const read = await readJsonLimited(req, MAX_BODY_BYTES)
  if (!read.ok) {
    return read.reason === 'too_large'
      ? NextResponse.json({ error: 'Request too large' }, { status: 413 })
      : NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const parsed = PutSchema.safeParse(read.body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid body' }, { status: 400 })
  }

  const repo = await getRepository()
  const mine = await repo.replaceUserDietaryRestrictions(userId, parsed.data.entries)
  return NextResponse.json({ mine })
}
