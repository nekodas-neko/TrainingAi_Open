import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'
import { requireAdmin } from '@/lib/admin'

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    await requireAdmin(session.user.id, session.user.isAdmin)
    const repo = await getRepository()
    const submissions = await repo.listFeedback()
    return NextResponse.json(submissions)
  } catch {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
}
