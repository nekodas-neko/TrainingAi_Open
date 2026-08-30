import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getRepositoryAsync } from '@/lib/data'
import { numericRouteId } from '@/lib/api/route-errors'

// Dismisses a pending scale reading (e.g. it was the owner's partner, not them) — the raw
// sample stays archived in scale_raw_samples (never deleted) but never reaches body_metrics.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const userId = session.user.id

  // BF-53 — `scale_raw_samples.id` is a `bigserial`, so the UUID guard that used to sit here
  // rejected every real request before the numeric check written for it could run.
  const { id: idParam } = await params
  const parsedId = numericRouteId(idParam)
  if (!parsedId.ok) return parsedId.response
  const id = parsedId.id

  const repo = await getRepositoryAsync()
  const dismissed = await repo.dismissScaleSample(userId, id)
  if (!dismissed) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  return NextResponse.json({ status: 'dismissed' })
}
