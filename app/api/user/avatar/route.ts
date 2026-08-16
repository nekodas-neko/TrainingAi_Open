import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'
import { rateLimit } from '@/lib/rate-limit'
import { readJsonLimited, isAllowedImageMime } from '@trainingai/shared/http/request-guards'

const MAX_SIZE = 5 * 1024 * 1024 // 5MB decoded image
// The data URL is base64 (~1.33×) plus JSON envelope — cap the raw body a bit above
// the decoded limit so a legitimate 5MB image isn't rejected by the stream guard.
const MAX_BODY_BYTES = 7 * 1024 * 1024

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // SEC-I2: match the other image-ingest routes — rate limit + a streaming size
  // guard (req.json() buffered the whole body before any size check) + a real MIME
  // whitelist (the old data:image/ prefix accepted svg+xml).
  if (!rateLimit(`${session.user.id}:avatar`, 10, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  const read = await readJsonLimited(req, MAX_BODY_BYTES)
  if (!read.ok) {
    const status = read.reason === 'too_large' ? 413 : 400
    return NextResponse.json({ error: read.reason === 'too_large' ? 'Image too large (max 5MB)' : 'Invalid request' }, { status })
  }
  const body = read.body as { avatar?: unknown }
  if (!body?.avatar || typeof body.avatar !== 'string') {
    return NextResponse.json({ error: 'Missing avatar' }, { status: 400 })
  }

  // data:image/png;base64,.... → validate the declared MIME against the whitelist.
  const mimeMatch = /^data:([^;,]+)[;,]/.exec(body.avatar)
  if (!mimeMatch || !isAllowedImageMime(mimeMatch[1])) {
    return NextResponse.json({ error: 'Unsupported image type (use JPEG, PNG or WebP)' }, { status: 400 })
  }
  const base64Data = body.avatar.split(',')[1] ?? ''
  const approxBytes = Math.ceil(base64Data.length * 0.75)
  if (approxBytes > MAX_SIZE) {
    return NextResponse.json({ error: 'Image too large (max 5MB)' }, { status: 400 })
  }

  const repo = await getRepository()
  const user = await repo.updateUserAvatar(session.user.id, body.avatar)
  return NextResponse.json({ avatar: user.avatar })
}
