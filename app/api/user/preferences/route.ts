import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'
import { readJsonLimited } from '@trainingai/shared/http/request-guards'
import { UserPreferencesPatchSchema } from '@trainingai/shared/user/preferences'

// Colour maps and the background settings bag are the big ones; everything else is a scalar or a
// short array of keys. 32 KB is far above any real bag and still far below a memory concern.
const MAX_BODY_BYTES = 32 * 1024

export async function GET() {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const repo = await getRepository()
  const preferences = await repo.getUserPreferences(userId)
  return NextResponse.json(preferences, { headers: { 'Cache-Control': 'private, no-store' } })
}

export async function PATCH(req: NextRequest) {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const read = await readJsonLimited(req, MAX_BODY_BYTES)
  if (!read.ok) {
    return read.reason === 'too_large'
      ? NextResponse.json({ error: 'Request too large' }, { status: 413 })
      : NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const parsed = UserPreferencesPatchSchema.safeParse(read.body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid body' }, { status: 400 })
  }

  // `null` means "clear this key", absence means "leave it alone" — the distinction the whole
  // merge rests on. An `undefined` value carries neither meaning and must not reach the merge,
  // where it would store a key whose value JSON then drops.
  const patch: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(parsed.data as Record<string, unknown>)) {
    if (value !== undefined) patch[key] = value
  }

  const repo = await getRepository()
  const preferences = await repo.updateUserPreferences(userId, patch)
  // Return the merged bag: the caller has just learned what another device set, without a
  // follow-up GET.
  return NextResponse.json(preferences, { headers: { 'Cache-Control': 'private, no-store' } })
}
