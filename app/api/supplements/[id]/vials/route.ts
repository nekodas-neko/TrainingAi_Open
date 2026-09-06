import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'
import { readJsonLimited } from '@trainingai/shared/http/request-guards'
import { invalidUuidResponse, withRouteErrors } from '@/lib/api/route-errors'

// One vial: four numbers and a date.
const MAX_BODY_BYTES = 4 * 1024

const VialBody = z.object({
  // Positive, not just finite: `strengthMg / 0` is Infinity, which survives every later
  // multiplication and renders as a plausible dose. A vial with no water is a typo.
  strengthMg:        z.number().finite().positive().max(10_000),
  waterMl:           z.number().finite().positive().max(1_000),
  syringeUnitsPerMl: z.number().finite().positive().max(1_000).default(100),
  // Both separators: the client's `localDateString()` emits YYYY/MM/DD.
  openedOn:          z.string().regex(/^\d{4}[-/]\d{2}[-/]\d{2}$/),
  id:                z.string().uuid().optional(),
}).strict()

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await ctx.params
  const bad = invalidUuidResponse(id)
  if (bad) return bad

  const repo = await getRepository()
  const vials = await repo.listSupplementVials(session.user.id, id)
  return NextResponse.json({ vials }, { headers: { 'Cache-Control': 'private, no-store' } })
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await ctx.params
  const bad = invalidUuidResponse(id)
  if (bad) return bad

  const read = await readJsonLimited(req, MAX_BODY_BYTES)
  if (!read.ok) {
    return read.reason === 'too_large'
      ? NextResponse.json({ error: 'Request too large' }, { status: 413 })
      : NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }
  const body = VialBody.safeParse(read.body)
  if (!body.success) return NextResponse.json({ error: 'Invalid body' }, { status: 400 })

  // `createSupplementVial` verifies the parent belongs to this user and throws NotFoundError;
  // `withRouteErrors` turns that into a 404 rather than an unhandled 500 (RV-46).
  return withRouteErrors(async () => {
    const repo = await getRepository()
    const vial = await repo.createSupplementVial(session.user!.id!, {
      ...body.data,
      openedOn: body.data.openedOn.replace(/\//g, '-'),
      supplementId: id,
    })
    return NextResponse.json({ vial }, { status: 201 })
  })
}
