import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'
import { z } from 'zod'
import { todayInTz, normalizeDateParamIso, DEFAULT_TZ } from '@trainingai/shared/date-utils'
import { withRouteErrors, invalidUuidResponse } from '@/lib/api/route-errors'
import { SupplementLogSchema } from '@trainingai/shared/validation/supplement'
import { readJsonLimited } from '@trainingai/shared/http/request-guards'
import { rateLimit } from '@/lib/rate-limit'

/** One dose. */
const MAX_BODY_BYTES = 4 * 1024

// Both separators: the client fills date params from `localDateString()`, which emits `YYYY/MM/DD`.
// The regex bounds the shape; `normalizeDateParamIso` rejects `2026-02-31` and answers the dash form
// `supplement_logs.log_date` is keyed by.
const DayQuerySchema = z.object({ date: z.string().regex(/^\d{4}[-/]\d{2}[-/]\d{2}$/) }).strict()

/**
 * #2813 — one supplement's log for one LOCAL date, manual tick apart from food-derived doses.
 * `?date=` is the user's local day as the client sees it; it is never converted through UTC, so a
 * dose logged just after local midnight reads back on the date it was logged for. A supplement that
 * is not the caller's answers 404, same as an unknown one.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const userId = session.user.id
  if (!rateLimit(`supplement-day-read:${userId}`, 120, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }
  const { id } = await params
  const badId = invalidUuidResponse(id)
  if (badId) return badId
  const parsed = DayQuerySchema.safeParse({ date: req.nextUrl.searchParams.get('date') ?? '' })
  const date = parsed.success ? normalizeDateParamIso(parsed.data.date) : null
  if (!date) return NextResponse.json({ error: 'Invalid date' }, { status: 400 })
  const repo = await getRepository()
  return withRouteErrors(async () => {
    const day = await repo.getSupplementDayLog(userId, id, date)
    return NextResponse.json(day, { headers: { 'Cache-Control': 'private, no-store' } })
  })
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  const badId = invalidUuidResponse(id)
  if (badId) return badId

  // BF-3 — an optional dose. **The body stays optional because the installed client sends none**:
  // `supplements-section.tsx` posts `fetch(url, { method })`, which still sends `Content-Length: 0`
  // — so the absent case is `no_body` OR `empty`, and treating only `no_body` as absent 400s every
  // request the shipped client makes. That is what the first dev-server run did, and no test caught
  // it, because the tests call the repository rather than the route.
  //
  // `invalid_json` stays a 400, because it means bytes arrived and did not parse. A client that
  // means to send a dose and sends garbage should hear about it rather than have its dose silently
  // replaced by the definition's — which is the failure this whole change is about.
  const read = await readJsonLimited(req, MAX_BODY_BYTES)
  if (!read.ok && read.reason === 'too_large') {
    return NextResponse.json({ error: 'Request too large' }, { status: 413 })
  }
  if (!read.ok && read.reason !== 'no_body' && read.reason !== 'empty') {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }
  // LA-98 — a PARTIAL, and the omissions are load-bearing.
  //
  // `SupplementLogSchema` declares all three fields optional under `.strict()`, so an omitted field
  // arrives as `undefined` and a field sent as null arrives as null — the parser already keeps them
  // apart. This used to flatten both to null with `?? null`, one line after the schema had taken
  // care to distinguish them, and `resolveLoggedDose` then could not tell "fill this from the
  // definition" from "this dose genuinely had none".
  //
  // Spreading conditionally rather than assigning `undefined` keeps the key ABSENT, which is what
  // `resolveLoggedDose` tests for.
  let dose: Partial<import('@trainingai/shared/types/supplement').SupplementDose> | undefined
  if (read.ok && read.body != null) {
    const parsed = SupplementLogSchema.safeParse(read.body)
    if (!parsed.success) return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
    dose = {
      ...(parsed.data.amount !== undefined ? { amount: parsed.data.amount } : {}),
      ...(parsed.data.unit !== undefined ? { unit: parsed.data.unit } : {}),
      ...(parsed.data.doseText !== undefined ? { doseText: parsed.data.doseText } : {}),
    }
  }

  const tz = session.user.timezone ?? DEFAULT_TZ
  const repo = await getRepository()
  // Q-463: logging a supplement that is not yours (or does not exist) answered 500 with an EMPTY
  // body, so the sync path read a permanent refusal as transient and retried it, and the client's
  // res.json() threw on top of the failure.
  return withRouteErrors(async () => {
    await repo.logSupplement(id, session.user!.id!, todayInTz(tz), dose)
    return NextResponse.json({ ok: true })
  })
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  const badId = invalidUuidResponse(id)
  if (badId) return badId
  const tz = session.user.timezone ?? DEFAULT_TZ
  const repo = await getRepository()
  return withRouteErrors(async () => {
    // RV-45: a delete that matched no row is reported as one that removed something, and the
    // sheets that call this do `if (!res.ok) throw` — so a refused cross-account delete, or a
    // stale id, confirms itself to the user and the row returns on the next pull. 404 matches
    // the Q-556 reference on activity-logs.
    const deleted = await repo.unlogSupplement(id, session.user!.id!, todayInTz(tz))
    if (!deleted) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json({ ok: true })
  })
}
