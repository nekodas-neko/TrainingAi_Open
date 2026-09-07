import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'
import { readJsonLimited } from '@trainingai/shared/http/request-guards'
import { invalidUuidResponse, withRouteErrors } from '@/lib/api/route-errors'

const MAX_BODY_BYTES = 4 * 1024

// Whitelisted field by field rather than spread from the body: `userId` and `deletedAt` are
// settable column keys and the TypeScript Omit is compile-time only (write-path rule (b)).
const VialPatch = z.object({
  strengthMg:        z.number().finite().positive().max(10_000).optional(),
  waterMl:           z.number().finite().positive().max(1_000).optional(),
  syringeUnitsPerMl: z.number().finite().positive().max(1_000).optional(),
  openedOn:          z.string().regex(/^\d{4}[-/]\d{2}[-/]\d{2}$/).optional(),
}).strict()

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ vialId: string }> }) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { vialId } = await ctx.params
  const bad = invalidUuidResponse(vialId)
  if (bad) return bad

  const read = await readJsonLimited(req, MAX_BODY_BYTES)
  if (!read.ok) {
    return read.reason === 'too_large'
      ? NextResponse.json({ error: 'Request too large' }, { status: 413 })
      : NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }
  const body = VialPatch.safeParse(read.body)
  if (!body.success) return NextResponse.json({ error: 'Invalid body' }, { status: 400 })

  // Editing a vial does NOT touch logs already stamped from it — that is the whole point of the
  // freeze, and it is why this is a plain update rather than a cascade.
  return withRouteErrors(async () => {
    const repo = await getRepository()
    const vial = await repo.updateSupplementVial(vialId, session.user!.id!, {
      ...body.data,
      ...(body.data.openedOn ? { openedOn: body.data.openedOn.replace(/\//g, '-') } : {}),
    })
    return NextResponse.json({ vial })
  })
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ vialId: string }> }) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { vialId } = await ctx.params
  const bad = invalidUuidResponse(vialId)
  if (bad) return bad

  const repo = await getRepository()
  // RV-45: a delete that matched no row is a 404, not a success.
  const deleted = await repo.deleteSupplementVial(vialId, session.user.id)
  if (!deleted) return NextResponse.json({ error: 'Vial not found' }, { status: 404 })
  return NextResponse.json({ ok: true })
}
