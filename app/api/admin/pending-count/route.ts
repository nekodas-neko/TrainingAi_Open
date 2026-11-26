import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'
import { requireAdmin, adminErrorResponse } from '@/lib/admin'
import { requireOwnerSession } from '@/lib/admin/claude-token-auth'

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

  // #3951: only the owner can open feedback, so only the owner's badge counts it. Another admin's
  // would be a dot they can never clear.
  // A failed owner lookup is 503, not "not the owner": a 200 with `feedbackCount: 0` would clear
  // the owner's badge during an outage as if the inbox were empty.
  const owner = await requireOwnerSession(session.user.id)
  if (!owner.ok && owner.status === 503) return NextResponse.json({ error: owner.error }, { status: 503 })
  const isOwner = owner.ok
  const repo = await getRepository()
  const [count, feedbackCount] = await Promise.all([
    repo.countPendingApprovalUsers(),
    isOwner ? repo.countFeedback() : 0,
  ])
  return NextResponse.json({ count, feedbackCount }, {
    headers: { 'Cache-Control': 'private, no-store' },
  })
}
