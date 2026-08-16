import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'
import { readJsonLimited } from '@trainingai/shared/http/request-guards'
import { rateLimit } from '@/lib/rate-limit'

const MAX_SCREENSHOT_BYTES = 500_000
const MAX_BODY_BYTES = 600 * 1024 // screenshot data URI dominates; keep headroom over 500KB cap

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (!rateLimit(`feedback:${session.user.id}`, 10, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  const result = await readJsonLimited(req, MAX_BODY_BYTES)
  if (!result.ok) return NextResponse.json({ error: result.reason }, { status: 400 })
  const { type, title, description, screenshotData } = result.body as {
    type?: unknown; title?: unknown; description?: unknown; screenshotData?: unknown
  }

  if (typeof type !== 'string' || !['bug', 'feature', 'other'].includes(type)) {
    return NextResponse.json({ error: 'type must be bug, feature, or other' }, { status: 400 })
  }
  if (typeof title !== 'string' || !title.trim()) {
    return NextResponse.json({ error: 'title is required' }, { status: 400 })
  }
  if (screenshotData != null && (typeof screenshotData !== 'string' || screenshotData.length > MAX_SCREENSHOT_BYTES)) {
    return NextResponse.json({ error: 'Screenshot too large' }, { status: 400 })
  }

  const repo = await getRepository()
  await repo.createFeedback(session.user.id, {
    type,
    title: title.trim().slice(0, 200),
    description: typeof description === 'string' ? description.trim().slice(0, 4000) || null : null,
    screenshotData: (screenshotData as string) || null,
  })
  return NextResponse.json({ ok: true }, { status: 201 })
}
