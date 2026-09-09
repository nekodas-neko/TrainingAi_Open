import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'
import { requireAdmin, adminErrorResponse } from '@/lib/admin'

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Q-548 — see the note on `admin/errors`. A bare catch around the check and the reads turned an
  // outage into 403, which is the one status nobody retries or escalates.
  try {
    await requireAdmin(session.user.id, session.user.isAdmin)
  } catch (err) {
    return adminErrorResponse(err)
  }

  const repo = await getRepository()
  const [count, feedbackCount] = await Promise.all([
    repo.countInactiveUsers(),
    repo.countFeedback(),
  ])
  return NextResponse.json({ count, feedbackCount }, {
    headers: { 'Cache-Control': 'private, no-store' },
  })
}
