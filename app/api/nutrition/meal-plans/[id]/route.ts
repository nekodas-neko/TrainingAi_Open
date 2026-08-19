import { NextResponse } from 'next/server'
import { z } from 'zod'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'
import { invalidUuidResponse } from '@/lib/api/route-errors'

// Whitelisted. `isActive` is here as an explicit boolean rather than a settable column passthrough,
// so activation still goes through the transactional path that clears the previous active plan.
const PatchSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  trainingTime: z.string().regex(/^\d{1,2}:\d{2}$/).nullable().optional(),
  avoidNote: z.string().max(2000).nullable().optional(),
  stores: z.array(z.string().max(60)).max(20).optional(),
  excludedFoods: z.array(z.string().max(80)).max(200).optional(),
  isActive: z.boolean().optional(),
})

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  const badId = invalidUuidResponse(id)
  if (badId) return badId

  const repo = await getRepository()
  const plan = await repo.getMealPlan(id, userId)
  // 404 rather than 403: a plan owned by someone else must not be distinguishable from one that
  // does not exist, or the id space becomes an enumeration oracle.
  if (!plan) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(plan, {
    headers: { 'Cache-Control': 'private, no-store' },
  })
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  const badId = invalidUuidResponse(id)
  if (badId) return badId

  let raw: unknown
  try { raw = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
  const parsed = PatchSchema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid body' }, { status: 400 })
  }
  const { isActive, ...fields } = parsed.data

  const repo = await getRepository()
  if (Object.keys(fields).length > 0) {
    const updated = await repo.updateMealPlan(id, userId, fields)
    if (!updated) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
  if (isActive !== undefined) {
    const activated = await repo.setMealPlanActive(id, userId, isActive)
    if (!activated) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json(activated)
  }

  const plan = await repo.getMealPlan(id, userId)
  if (!plan) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(plan)
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  const badId = invalidUuidResponse(id)
  if (badId) return badId

  const repo = await getRepository()
  // Soft delete — the tombstone is what lets the removal reach a device that has not synced.
  const ok = await repo.deleteMealPlan(id, userId)
  if (!ok) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ success: true })
}
