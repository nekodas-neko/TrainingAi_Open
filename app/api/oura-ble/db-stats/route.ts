import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { requireAdmin } from '@/lib/admin'
import { getRepositoryAsync } from '@/lib/data'
import { rateLimit } from '@/lib/rate-limit'

// DB-footprint readout for the /admin/oura-ble tester (Sub-plan G-2). Row estimates + total bytes
// per Oura table, plus the oura_raw_samples decoded-vs-body_hex split, so the owner can measure what
// the ingestion-culling levers reclaim before running the destructive ones. Read-only, admin-gated.
export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    await requireAdmin(session.user.id, session.user.isAdmin)
  } catch {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // The raw-sample split scans oura_raw_samples — keep it occasional.
  if (!rateLimit(`oura-ble-db-stats:${session.user.id}`, 10, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  const repo = await getRepositoryAsync()
  const stats = await repo.getOuraStorageStats()
  return NextResponse.json(stats, {
    headers: { 'Cache-Control': 'private, no-store' },
  })
}
