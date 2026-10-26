import { NextResponse } from 'next/server'
import { refusalResponse, isRefusal, invalidUuidResponse, invalidBodyResponse } from '@/lib/api/route-errors'
import { reportServerError } from '@/lib/observability'
import { auth } from '@/auth'
import { getRepositoryAsync } from '@/lib/data'
import { requireTrainerOf } from '@/lib/trainer'
import { rateLimit } from '@/lib/rate-limit'
import { readJsonLimited } from '@trainingai/shared/http/request-guards'
import { AssignProgramBodySchema } from '@trainingai/shared/validation/trainer'

// A whole program with its sessions and exercises — the same ceiling as /api/workout-templates.
const MAX_BODY_BYTES = 256 * 1024

type Ctx = { params: Promise<{ traineeId: string }> }

/** What this trainer has assigned to this trainee: summaries only, never the trainee's other data. */
export async function GET(_req: Request, { params }: Ctx) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!rateLimit(`trainer-assigned-list:${session.user.id}`, 60, 60 * 1000)) {
    return NextResponse.json({ error: 'Too many requests. Please try again later.' }, { status: 429 })
  }
  const { traineeId } = await params
  const badId = invalidUuidResponse(traineeId)
  if (badId) return badId

  try {
    await requireTrainerOf(session.user.id, traineeId)
    const programs = await (await getRepositoryAsync()).listProgramsAssignedBy(session.user.id, traineeId)
    return NextResponse.json({ programs }, { headers: { 'Cache-Control': 'private, no-store' } })
  } catch (e: unknown) {
    if (!isRefusal(e)) reportServerError(e, { userId: session.user.id, url: '/api/trainer/trainees/[traineeId]/programs' })
    return refusalResponse(e, 'Could not load assigned programs')
  }
}

/**
 * Build a program in the trainee's account and assign it, in one call. The trainee must have
 * accepted. The body is Zod-whitelisted and carries no ids except `styleId`, which names a style in
 * the TRAINER's library and is replaced by a copy the trainee owns. The program arrives inactive.
 */
export async function POST(req: Request, { params }: Ctx) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!rateLimit(`trainer-assign:${session.user.id}`, 20, 60 * 60 * 1000)) {
    return NextResponse.json({ error: 'Too many requests. Please try again later.' }, { status: 429 })
  }
  const { traineeId } = await params
  const badId = invalidUuidResponse(traineeId)
  if (badId) return badId

  // The guard runs before the body is read: someone who is not this trainee's trainer learns
  // nothing from how their body validates.
  try {
    await requireTrainerOf(session.user.id, traineeId)
  } catch (e: unknown) {
    if (!isRefusal(e)) reportServerError(e, { userId: session.user.id, url: '/api/trainer/trainees/[traineeId]/programs' })
    return refusalResponse(e, 'Could not assign that program')
  }

  const read = await readJsonLimited(req, MAX_BODY_BYTES)
  if (!read.ok) {
    return read.reason === 'too_large'
      ? NextResponse.json({ error: 'Request too large' }, { status: 413 })
      : NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  const parsed = AssignProgramBodySchema.safeParse(read.body ?? {})
  if (!parsed.success) return invalidBodyResponse(parsed.error)

  try {
    const { assignmentId, program } = await (await getRepositoryAsync())
      .assignProgramToTrainee(session.user.id, traineeId, parsed.data.program)
    return NextResponse.json({ ok: true, assignmentId, program }, { status: 201 })
  } catch (e: unknown) {
    if (!isRefusal(e)) {
      reportServerError(e, { userId: session.user.id, url: '/api/trainer/trainees/[traineeId]/programs' })
      console.error('[trainer assign POST]', e)
    }
    return refusalResponse(e, 'Could not assign that program')
  }
}
