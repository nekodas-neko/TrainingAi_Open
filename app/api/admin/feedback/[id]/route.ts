import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'
import { requireAdmin } from '@/lib/admin'

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    await requireAdmin(session.user.id, session.user.isAdmin)
    const { id } = await params
    const repo = await getRepository()
    await repo.deleteFeedback(id)
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
}
