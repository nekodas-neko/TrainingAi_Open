import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { requireAdmin } from '@/lib/admin'
import { getRepositoryAsync } from '@/lib/data'
import { rateLimit } from '@/lib/rate-limit'

// Culling Lever 1c — admin-triggered VACUUM FULL on oura_raw_samples. Physically reclaims the disk
// that Lever 1b freed only logically: nulling `decoded` leaves dead tuples that autovacuum reuses
// internally but never returns to the OS (Postgres MVCC — see docs/oura-ble-operations.md I17).
// No data is dropped — VACUUM FULL rewrites the table into a smaller file. It takes a brief
// ACCESS EXCLUSIVE lock on the table, so keep it a deliberate, rare, owner-pressed action.
export async function POST() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    await requireAdmin(session.user.id, session.user.isAdmin)
  } catch {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Expensive whole-table maintenance that briefly locks the table — keep it rare.
  if (!rateLimit(`oura-ble-vacuum-raw:${session.user.id}`, 2, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  const repo = await getRepositoryAsync()
  const result = await repo.vacuumOuraRawSamples()
  return NextResponse.json(result)
}
