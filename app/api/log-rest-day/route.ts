import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'
import { z } from 'zod'
import { todayInTz, DEFAULT_TZ, normalizeDateParamIso } from '@trainingai/shared/date-utils'
import { rateLimit } from '@/lib/rate-limit'
import { readJsonLimited } from '@trainingai/shared/http/request-guards'

/**
 * BF-84 — choosing (or un-choosing) a rest day.
 *
 * This route used to persist nothing. Its comment said so: *"Rest days are inferred from gaps in
 * workout_sessions — no row needed"*, and the whole feature was a `localStorage` marker the client
 * re-applied over `/api/next-session`'s answer. The owner settled it the other way — a chosen rest
 * day is a fact, because a day with no logged workout is also a day you forgot, were ill, or logged
 * late, and only a stored row separates those.
 */

// `{ date?, resting? }` and nothing else.
const MAX_BODY_BYTES = 1024

const Body = z.object({
  // Both separators: the client fills this from localDateString(), which emits slashes — a
  // dash-only regex rejects every real request before the handler runs (Q-130).
  date: z.string().regex(/^\d{4}[-/]\d{2}[-/]\d{2}$/).optional(),
  /** Omitted means "choose rest", so the pre-BF-84 bodiless POST keeps working. */
  resting: z.boolean().optional(),
}).strict()

export async function POST(req: Request) {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!rateLimit(`log-rest-day:${userId}`, 60, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  // The pre-BF-84 client posted no body at all, and the web fallback path still does. `empty` and
  // `no_body` are therefore a valid "rest today" here rather than a malformed request — the one
  // route where an absent body is the common case, not an error.
  const read = await readJsonLimited(req, MAX_BODY_BYTES)
  if (!read.ok && read.reason !== 'empty' && read.reason !== 'no_body') {
    return read.reason === 'too_large'
      ? NextResponse.json({ error: 'Body too large' }, { status: 413 })
      : NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }
  const parsed = Body.safeParse(read.ok ? read.body : {})
  if (!parsed.success) return NextResponse.json({ error: 'Invalid body' }, { status: 400 })

  const tz = session.user?.timezone ?? DEFAULT_TZ
  const date = parsed.data.date ? normalizeDateParamIso(parsed.data.date) : todayInTz(tz)
  if (!date) return NextResponse.json({ error: 'Invalid date' }, { status: 400 })

  const repo = await getRepository()
  await repo.setRestDay(userId, date, parsed.data.resting ?? true)
  return NextResponse.json({ ok: true, date, resting: parsed.data.resting ?? true }, {
    headers: { 'Cache-Control': 'private, no-store' },
  })
}

export async function GET(req: Request) {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const url = new URL(req.url)
  const tz = session.user?.timezone ?? DEFAULT_TZ
  const rawFrom = url.searchParams.get('from')
  const rawTo = url.searchParams.get('to')
  const from = rawFrom ? normalizeDateParamIso(rawFrom) : todayInTz(tz)
  const to = rawTo ? normalizeDateParamIso(rawTo) : from
  if (!from || !to) return NextResponse.json({ error: 'Invalid date' }, { status: 400 })
  const repo = await getRepository()
  return NextResponse.json({ dates: await repo.listRestDays(userId, from, to) }, {
    headers: { 'Cache-Control': 'private, no-store' },
  })
}
