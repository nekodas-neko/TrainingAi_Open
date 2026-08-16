import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { requireAdmin } from '@/lib/admin'
import { getRepositoryAsync } from '@/lib/data'

// What's been recorded from the ring so far — feeds the /admin/oura-ble tester UI.
export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    await requireAdmin(session.user.id, session.user.isAdmin)
  } catch {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const repo = await getRepositoryAsync()
  const summary = await repo.getOuraRawSampleSummary(session.user.id)

  return NextResponse.json(summary, {
    headers: { 'Cache-Control': 'private, no-store' },
  })
}
