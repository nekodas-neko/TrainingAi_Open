import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'
import { isAdminUser } from '@/lib/admin'
import { z } from 'zod'
import type { MuscleAssignment } from '@trainingai/shared/types/program'
import { reportServerError } from '@/lib/observability'

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

  const body = CreateBody.safeParse(await req.json())
  if (!body.success) return NextResponse.json({ error: 'Invalid body' }, { status: 400 })

  const repo = await getRepository()

  if (body.data.mergeWithId) {
    try {
      const exercise = await repo.renameExercise(session.user.id, body.data.mergeWithId, body.data.name)
      return NextResponse.json({ exercise })
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Rename failed'
      const status = msg.includes('Not authorized') ? 403 : 400
      return NextResponse.json({ error: msg }, { status })
    }
  }

  if (!(await isAdminUser(session.user.id, session.user.isAdmin))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
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
    const msg = e instanceof Error ? e.message : 'Create failed'
    if (msg.toLowerCase().includes('unique') || msg.toLowerCase().includes('duplicate')) {
      return NextResponse.json({ error: 'An exercise with that name already exists' }, { status: 409 })
    }
    // Reported only past the duplicate-name branch: a 409 is the user picking a taken name, not a
    // server fault, and logging it would bury real failures in routine noise.
    reportServerError(e, { url: '/api/exercises' })
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
