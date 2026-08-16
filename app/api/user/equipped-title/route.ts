import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getRepositoryAsync } from '@/lib/data'
import { TITLES } from '@trainingai/shared/types/friends'

export async function PATCH(req: Request) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { titleId } = await req.json()
  if (titleId !== null && (typeof titleId !== 'string' || !TITLES[titleId])) {
    return NextResponse.json({ error: 'Invalid title' }, { status: 400 })
  }
  const repo = await getRepositoryAsync()
  await repo.updateEquippedTitle(session.user.id, titleId)
  return NextResponse.json({ equippedTitle: titleId })
}
