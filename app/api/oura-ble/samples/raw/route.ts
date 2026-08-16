import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { requireAdmin } from '@/lib/admin'
import { getRepositoryAsync } from '@/lib/data'

// Raw frame dump for the /admin/oura-ble tester — all recent frames for the given
// event tags (not just the inspector's newest-per-tag), for cracking undecoded tags
// (e.g. hunting a step count across the activity/step-feature frames). Read-only.
//
// ?tags=7e,7f,50,51,52 (comma-separated hex, defaults to the step/activity family)
// ?limit=120 (max 1000)
const DEFAULT_TAGS = [0x7e, 0x7f, 0x50, 0x51, 0x52]

export async function GET(req: Request) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    await requireAdmin(session.user.id, session.user.isAdmin)
  } catch {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const url = new URL(req.url)
  const tagsParam = url.searchParams.get('tags')
  const tags = tagsParam
    ? tagsParam.split(',').map((t) => parseInt(t.trim(), 16)).filter((n) => Number.isInteger(n) && n >= 0 && n <= 0xff)
    : DEFAULT_TAGS
  const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') ?? '120', 10) || 120, 1), 1000)

  const repo = await getRepositoryAsync()
  const rows = await repo.getOuraRawSamplesByTags(session.user.id, tags, limit)

  return NextResponse.json({ rows }, {
    headers: { 'Cache-Control': 'private, no-store' },
  })
}
