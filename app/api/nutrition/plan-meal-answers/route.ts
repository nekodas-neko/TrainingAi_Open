import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'
import { normalizeDateParam } from '@trainingai/shared/date-utils'
import { readJsonLimited } from '@trainingai/shared/http/request-guards'

// Two uuids and a date.
const MAX_BODY_BYTES = 4 * 1024

/**
 * Q-187 phase 2 — "did you eat this planned meal?", the "no" half.
 *
 * Only declines reach this route. A "yes" writes a real food log through the existing `logPlanMeal`
 * path instead, so the day's totals count food the user confirmed and nothing else. An unconfirmed
 * prefill never enters `food_logs` at all, which is what keeps its 23 readers correct without
 * teaching any of them a new filter.
 */

// Both separators: the client fills date params from `localDateString()`, which emits slashes, and
// a dash-only regex rejects every real request with a Zod error before the handler runs.
const DATE_RE = /^\d{4}[-/]\d{2}[-/]\d{2}$/

const BodySchema = z.object({
  // Client-minted so the write is idempotent on outbox replay.
  id:         z.string().uuid().optional(),
  planMealId: z.string().uuid(),
  logDate:    z.string().regex(DATE_RE),
}).strict()

const DeleteSchema = z.object({
  planMealId: z.string().uuid(),
  logDate:    z.string().regex(DATE_RE),
}).strict()

export async function GET(req: NextRequest) {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const raw = req.nextUrl.searchParams.get('date')
  if (!raw || !DATE_RE.test(raw)) {
    return NextResponse.json({ error: 'Invalid or missing date' }, { status: 400 })
  }
  // The regex fixed the shape; this also rejects impossible calendar dates (2026-02-31 matches the
  // regex). A raw param reaching date arithmetic is how several routes 500'd with an invalid time.
  const date = normalizeDateParam(raw)
  if (!date) return NextResponse.json({ error: 'Invalid date' }, { status: 400 })
  const repo = await getRepository()
  const answers = await repo.listPlanMealAnswers(userId, date)
  return NextResponse.json({ answers }, { headers: { 'Cache-Control': 'private, no-store' } })
}

export async function POST(req: NextRequest) {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const read = await readJsonLimited(req, MAX_BODY_BYTES)
  if (!read.ok) {
    return read.reason === 'too_large'
      ? NextResponse.json({ error: 'Request too large' }, { status: 413 })
      : NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const parsed = BodySchema.safeParse(read.body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid body' }, { status: 400 })
  }

  const logDate = normalizeDateParam(parsed.data.logDate)
  if (!logDate) return NextResponse.json({ error: 'Invalid date' }, { status: 400 })

  const repo = await getRepository()
  const answer = await repo.savePlanMealAnswer(userId, {
    id: parsed.data.id,
    planMealId: parsed.data.planMealId,
    logDate,
  })
  // Null means the plan meal is not this user's, or does not exist. One response for both, so the
  // route cannot be used to probe which meal ids are real.
  if (!answer) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ answer })
}

export async function DELETE(req: NextRequest) {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const read = await readJsonLimited(req, MAX_BODY_BYTES)
  if (!read.ok) {
    return read.reason === 'too_large'
      ? NextResponse.json({ error: 'Request too large' }, { status: 413 })
      : NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const parsed = DeleteSchema.safeParse(read.body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid body' }, { status: 400 })
  }

  const logDate = normalizeDateParam(parsed.data.logDate)
  if (!logDate) return NextResponse.json({ error: 'Invalid date' }, { status: 400 })

  const repo = await getRepository()
  const removed = await repo.deletePlanMealAnswer(userId, parsed.data.planMealId, logDate)
  return NextResponse.json({ removed })
}
