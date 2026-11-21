import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'
import { requireAdmin, adminErrorResponse } from '@/lib/admin'
import { requireOwnerSession } from '@/lib/admin/claude-token-auth'

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Q-548 — the bare catch here covered the READ as well, so a failed query answered 403 and read
  // as a permissions problem. The check answers 403 or 503; the read is outside it and surfaces as
  // the fault it is.
  try {
    await requireAdmin(session.user.id, session.user.isAdmin)
  } catch (err) {
    return adminErrorResponse(err)
  }
  // #3951: feedback is every account's free text, so only the owner reads it. Any other admin gets
  // the same refusal as db-query and db-snapshot (#3657); an owner that cannot be resolved refuses all.
  const owner = await requireOwnerSession(session.user.id)
  if (!owner.ok) return NextResponse.json({ error: owner.error }, { status: owner.status })

  const repo = await getRepository()
  const submissions = await repo.listFeedback()
  return NextResponse.json(submissions)
}
