import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'
import { requireAdmin } from '@/lib/admin'

async function assertAdmin() {
  const session = await auth()
  if (!session?.user?.id) throw new Error('Unauthorized')
  await requireAdmin(session.user.id, session.user.isAdmin)
}

export async function GET() {
  try {
    await assertAdmin()
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Forbidden'
    return NextResponse.json({ error: msg }, { status: msg === 'Unauthorized' ? 401 : 403 })
  }
  const repo = await getRepository()
  const emails = await repo.listInvites()
  return NextResponse.json({ emails })
}

export async function POST(req: NextRequest) {
  try {
    await assertAdmin()
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Forbidden'
    return NextResponse.json({ error: msg }, { status: msg === 'Unauthorized' ? 401 : 403 })
  }
  const { email } = await req.json()
  if (!email || typeof email !== 'string') {
    return NextResponse.json({ error: 'email required' }, { status: 400 })
  }
  const repo = await getRepository()
  await repo.addInvite(email.toLowerCase().trim())
  return NextResponse.json({ ok: true })
}

export async function DELETE(req: NextRequest) {
  try {
    await assertAdmin()
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Forbidden'
    return NextResponse.json({ error: msg }, { status: msg === 'Unauthorized' ? 401 : 403 })
  }
  const { email } = await req.json()
  if (!email) return NextResponse.json({ error: 'email required' }, { status: 400 })
  const repo = await getRepository()
  await repo.removeInvite(email)
  return NextResponse.json({ ok: true })
}
