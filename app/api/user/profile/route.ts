import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'
import { ACTIVITY_LEVELS, FITNESS_GOALS } from '@trainingai/shared/types/user'
import { readJsonLimited } from '@trainingai/shared/http/request-guards'

// Eight fields, the longest capped at 100 characters by the schema below. 8 KB is generous.
const MAX_BODY_BYTES = 8 * 1024

const ProfileSchema = z.object({
  displayName:   z.string().min(1).max(100).optional().nullable(),
  heightCm:      z.number().min(50).max(300).optional().nullable(),
  dateOfBirth:   z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  weightGoalKg:  z.number().min(20).max(500).optional().nullable(),
  timezone:      z.string().max(60).optional().nullable(),
  sex:           z.enum(['male', 'female', 'other']).optional().nullable(),
  activityLevel: z.enum([...ACTIVITY_LEVELS]).optional().nullable(),
  fitnessGoal:   z.enum([...FITNESS_GOALS]).optional().nullable(),
}).strict()

/** The keys `ProfileSchema` accepts, as data — so the PATCH forwarding cannot drift from it. */
const PROFILE_FIELDS = Object.keys(ProfileSchema.shape) as (keyof typeof ProfileSchema.shape)[]

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const repo = await getRepository()
  const [userWithHash, workoutCount] = await Promise.all([
    repo.getUserByEmail(session.user.email!),
    repo.countWorkoutSessions(session.user.id),
  ])
  if (!userWithHash) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { passwordHash, ...user } = userWithHash
  return NextResponse.json(
    { user, hasPassword: !!passwordHash, workoutCount },
    { headers: { "Cache-Control": "private, no-store" } },
  )
}

export async function PATCH(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // `safeParse(await req.json())` threw on malformed JSON before the schema could answer, so a bad
  // body was a 500 rather than the 400 the schema would have given it.
  const read = await readJsonLimited(req, MAX_BODY_BYTES)
  if (!read.ok) {
    return read.reason === 'too_large'
      ? NextResponse.json({ error: 'Request too large' }, { status: 413 })
      : NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = ProfileSchema.safeParse(read.body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid body' }, { status: 400 })
  }
  // BF-78. Forward only the keys the request actually sent, so `omitted` and `sent as null` stop
  // meaning the same thing. The old shape mapped every field through `?? undefined`, which
  // collapsed the two — an explicit `heightCm: null` became indistinguishable from not mentioning
  // height, and no field could ever be cleared. `sex` was already the exception, and its
  // `!== undefined` test is the pattern the rest now follow.
  const patch: Parameters<Awaited<ReturnType<typeof getRepository>>['updateUserProfile']>[1] = {}
  for (const key of PROFILE_FIELDS) {
    if (key in parsed.data) {
      // Each key's type is checked by the schema above; the loop is what keeps the eight in step.
      ;(patch as Record<string, unknown>)[key] = parsed.data[key]
    }
  }

  const repo = await getRepository()
  const user = await repo.updateUserProfile(session.user.id, patch)
  return NextResponse.json({ user })
}
