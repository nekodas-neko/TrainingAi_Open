import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getRepositoryAsync } from '@/lib/data'
import { TITLES } from '@trainingai/shared/types/friends'
import { readJsonLimited } from '@trainingai/shared/http/request-guards'

// One title id.
const MAX_BODY_BYTES = 4 * 1024

export async function PATCH(req: Request) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const read = await readJsonLimited(req, MAX_BODY_BYTES)
  if (!read.ok) {
    return read.reason === 'too_large'
      ? NextResponse.json({ error: 'Request too large' }, { status: 413 })
      : NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  const { titleId } = (read.body ?? {}) as { titleId?: unknown }
  if (titleId !== null && (typeof titleId !== 'string' || !TITLES[titleId])) {
    return NextResponse.json({ error: 'Invalid title' }, { status: 400 })
  }
  const repo = await getRepositoryAsync()
  await repo.updateEquippedTitle(session.user.id, titleId)
  return NextResponse.json({ equippedTitle: titleId })
}
