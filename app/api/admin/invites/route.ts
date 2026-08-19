import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'
import { requireAdmin, adminErrorResponse } from '@/lib/admin'

/**
 * Returns the response to send, or null to proceed. The three verbs previously caught
 * `requireAdmin` and echoed the caught message with the status matched out of its text — so a DB
 * outage inside the admin check answered 403 with the connection error as the body (Q-320). A
 * failure to *check* is an outage (503), not a refusal.
 */
async function adminGate(): Promise<NextResponse | null> {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    await requireAdmin(session.user.id, session.user.isAdmin)
  } catch (e) {
    return adminErrorResponse(e)
  }
  return null
}

export async function GET() {
  const denied = await adminGate()
  if (denied) return denied
  const repo = await getRepository()
  const emails = await repo.listInvites()
  return NextResponse.json({ emails })
}

export async function POST(req: NextRequest) {
  const denied = await adminGate()
  if (denied) return denied
  const { email } = await req.json()
  if (!email || typeof email !== 'string') {
    return NextResponse.json({ error: 'email required' }, { status: 400 })
  }
  const repo = await getRepository()
  await repo.addInvite(email.toLowerCase().trim())
  return NextResponse.json({ ok: true })
}

export async function DELETE(req: NextRequest) {
  const denied = await adminGate()
  if (denied) return denied
  const { email } = await req.json()
  if (!email) return NextResponse.json({ error: 'email required' }, { status: 400 })
  const repo = await getRepository()
  await repo.removeInvite(email)
  return NextResponse.json({ ok: true })
}
