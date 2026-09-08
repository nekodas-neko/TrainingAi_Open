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
  // `hasOwnProperty`, not `TITLES[titleId]`: the catalogue is a plain object literal, so a bare
  // lookup reaches Object.prototype and `constructor`, `toString`, `valueOf`, `__proto__` and four
  // more siblings all read as truthy — eight ids that passed this guard, got stored, and then failed
  // to render. `profile-tab.tsx` mounts `<title.Icon />` from the same map, and
  // `(Object).Icon` is undefined, which React answers with a hard "element type is invalid" crash.
  // The stored value survives a reload, so the profile tab stays white until the row is edited.
  const known = typeof titleId === 'string' && Object.prototype.hasOwnProperty.call(TITLES, titleId)
  if (titleId !== null && !known) {
    return NextResponse.json({ error: 'Invalid title' }, { status: 400 })
  }
  const repo = await getRepositoryAsync()
  await repo.updateEquippedTitle(session.user.id, titleId)
  return NextResponse.json({ equippedTitle: titleId })
}
