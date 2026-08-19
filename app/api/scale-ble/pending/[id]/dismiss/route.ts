import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getRepositoryAsync } from '@/lib/data'
import { invalidUuidResponse } from '@/lib/api/route-errors'

// Dismisses a pending scale reading (e.g. it was the owner's partner, not them) — the raw
// sample stays archived in scale_raw_samples (never deleted) but never reaches body_metrics.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const userId = session.user.id

  const { id: idParam } = await params
  const badId = invalidUuidResponse(idParam)
  if (badId) return badId
  const id = Number(idParam)
  if (!Number.isInteger(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

  const repo = await getRepositoryAsync()
  const dismissed = await repo.dismissScaleSample(userId, id)
  if (!dismissed) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  return NextResponse.json({ status: 'dismissed' })
}
