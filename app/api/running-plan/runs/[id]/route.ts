import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'
import { rateLimit } from '@/lib/rate-limit'
import { PrescribedRunPatchBody } from '@trainingai/shared/validation/prescribed-run'

// Mark a prescribed run completed/skipped (optionally linking the actual activity_logs run).
// This is the exact write the pushMutations 'prescribed_run' branch performs — same shared
// schema, same repo function — so the web and offline-sync paths cannot drift.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!rateLimit(`${userId}:prescribed-run`, 30, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  const { id } = await params
  const parsed = PrescribedRunPatchBody.safeParse({ ...(await req.json().catch(() => ({}))), id })
  if (!parsed.success) return NextResponse.json({ error: 'Invalid body' }, { status: 400 })

  const repo = await getRepository()
  const updated = await repo.updatePrescribedRun(userId, id, {
    status: parsed.data.status,
    activityLogId: parsed.data.activityLogId ?? null,
  })
  if (!updated) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ run: updated })
}
