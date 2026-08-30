import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'
import { todayInTz, DEFAULT_TZ } from '@trainingai/shared/date-utils'
import { withRouteErrors, invalidUuidResponse } from '@/lib/api/route-errors'
import { SupplementLogSchema } from '@trainingai/shared/validation/supplement'
import { readJsonLimited } from '@trainingai/shared/http/request-guards'

/** One dose. */
const MAX_BODY_BYTES = 4 * 1024

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
  let dose: import('@trainingai/shared/types/supplement').SupplementDose | undefined
  if (read.ok && read.body != null) {
    const parsed = SupplementLogSchema.safeParse(read.body)
    if (!parsed.success) return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
    dose = {
      amount: parsed.data.amount ?? null,
      unit: parsed.data.unit ?? null,
      doseText: parsed.data.doseText ?? null,
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
    await repo.unlogSupplement(id, session.user!.id!, todayInTz(tz))
    return NextResponse.json({ ok: true })
  })
}
