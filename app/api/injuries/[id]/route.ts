import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'

// SEC-I4: the web PATCH forwarded an unvalidated body — the adapter key-whitelists
// columns (no mass assignment) but never checked value types/enums, so the offline
// sync path (which does enforce the severity enum) was stricter than web. Validate at
// the route, matching the supplement-patch pattern.
const InjuryPatchSchema = z.object({
  muscleName:   z.string().min(1).max(100).optional(),
  notes:        z.string().max(1000).nullable().optional(),
  severity:     z.enum(['mild', 'moderate', 'severe']).optional(),
  startedDate:  z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  resolvedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
}).strict()

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const parsed = InjuryPatchSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  const repo = await getRepository()
  const injury = await repo.updateInjury(id, session.user.id, parsed.data)
  return NextResponse.json(injury)
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const repo = await getRepository()
  await repo.deleteInjury(id, session.user.id)
  return NextResponse.json({ ok: true })
}
