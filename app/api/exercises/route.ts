import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'
import { requireAdmin, adminErrorResponse } from '@/lib/admin'
import { z } from 'zod'
import type { MuscleAssignment } from '@trainingai/shared/types/program'
import { reportServerError } from '@/lib/observability'
import { refusalResponse, isRefusal } from '@/lib/api/route-errors'
import { readJsonLimited } from '@trainingai/shared/http/request-guards'

// An exercise with muscles, equipment and instructions.
const MAX_BODY_BYTES = 32 * 1024

const CreateBody = z.object({
  name:         z.string().min(1).max(120),
  muscles:      z.array(z.object({ muscle: z.string(), role: z.enum(['main', 'secondary']) })).default([]),
  equipment:    z.array(z.string()).default([]),
  instructions: z.string().max(2000).optional(),
  exerciseType: z.enum(['weighted', 'bodyweight']).default('weighted'),
  mergeWithId:  z.string().uuid().optional(),
})

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const read = await readJsonLimited(req, MAX_BODY_BYTES)
  if (!read.ok) {
    return read.reason === 'too_large'
      ? NextResponse.json({ error: 'Request too large' }, { status: 413 })
      : NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }
  const body = CreateBody.safeParse(read.body)
  if (!body.success) return NextResponse.json({ error: 'Invalid body' }, { status: 400 })

  const repo = await getRepository()

  if (body.data.mergeWithId) {
    try {
      const exercise = await repo.renameExercise(session.user.id, body.data.mergeWithId, body.data.name)
      return NextResponse.json({ exercise })
    } catch (e) {
      if (!isRefusal(e)) reportServerError(e, { userId: session.user.id, url: '/api/exercises' })
      return refusalResponse(e, 'Rename failed')
    }
  }

  // Q-479: this used to be `isAdminUser(session.user.id, session.user.isAdmin)`, and passing the
  // second argument makes that helper *return the JWT claim* rather than read the row. The claim is
  // refreshed at most once a day (`ISACTIVE_RECHECK_MS`), so a revoked admin kept writing to the
  // shared exercise catalogue for up to 24 hours — measured at 201 here against 403 from
  // `/api/admin/errors` on the same cookie in the same instant. `requireAdmin` reads the row every
  // call, which is what the other 61 API routes do.
  try {
    await requireAdmin(session.user.id)
  } catch (err) {
    return adminErrorResponse(err)
  }

  try {
    const exercise = await repo.createExercise({
      name:         body.data.name,
      muscles:      body.data.muscles as MuscleAssignment[],
      equipment:    body.data.equipment,
      instructions: body.data.instructions,
      createdBy:    session.user.id,
      exerciseType: body.data.exerciseType,
    })
    return NextResponse.json({ exercise }, { status: 201 })
  } catch (e) {
    // The unique-constraint match stays on the raw message: this one is the *driver's* error, not a
    // thrown refusal, so there is nothing to mark. Only the branch is derived from it — the text
    // never reaches the client.
    const msg = e instanceof Error ? e.message.toLowerCase() : ''
    if (msg.includes('unique') || msg.includes('duplicate')) {
      return NextResponse.json({ error: 'An exercise with that name already exists' }, { status: 409 })
    }
    // Reported only past the duplicate-name branch: a 409 is the user picking a taken name, not a
    // server fault, and logging it would bury real failures in routine noise.
    reportServerError(e, { url: '/api/exercises' })
    return refusalResponse(e, 'Create failed')
  }
}
