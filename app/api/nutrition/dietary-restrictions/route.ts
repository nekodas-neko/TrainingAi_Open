import { NextResponse } from 'next/server'
import { z } from 'zod'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'
import type { DietaryRestriction, UserDietaryRestriction } from '@trainingai/shared/types/nutrition'

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

  let raw: unknown
  try { raw = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
  const parsed = PutSchema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid body' }, { status: 400 })
  }

  const repo = await getRepository()
  const mine = await repo.replaceUserDietaryRestrictions(userId, parsed.data.entries)
  return NextResponse.json({ mine })
}
