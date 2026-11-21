import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'
import { requireAdmin, adminErrorResponse } from '@/lib/admin'
import { requireOwnerSession } from '@/lib/admin/claude-token-auth'
import { invalidUuidResponse } from '@/lib/api/route-errors'

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Q-548 — see the sibling. The old catch also swallowed the malformed-id 400 and the delete
  // itself, so both came back as `Forbidden`: a mistyped id looked like a permissions problem.
  try {
    await requireAdmin(session.user.id, session.user.isAdmin)
  } catch (err) {
    return adminErrorResponse(err)
  }
  // #3951: deleting feedback is the owner's, as reading it is (see the sibling).
  const owner = await requireOwnerSession(session.user.id)
  if (!owner.ok) return NextResponse.json({ error: owner.error }, { status: owner.status })

  const { id } = await params
  const badId = invalidUuidResponse(id)
  if (badId) return badId

  const repo = await getRepository()
  await repo.deleteFeedback(id)
  return NextResponse.json({ ok: true })
}
