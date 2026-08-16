import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getRepositoryAsync } from '@/lib/data'

// Cheap local-DB read (no Oura Cloud call) so app-open call sites can decide whether to
// bother firing the frozen Cloud sync — see lib/oura/ble-freshness.ts.
export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const repo = await getRepositoryAsync()
  const lastMeasuredAt = await repo.getLatestOuraBleMeasuredAt(session.user.id)

  return NextResponse.json(
    { lastMeasuredAt: lastMeasuredAt ? lastMeasuredAt.toISOString() : null },
    { headers: { 'Cache-Control': 'private, no-store' } },
  )
}
