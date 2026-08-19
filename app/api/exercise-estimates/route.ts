import { NextResponse } from 'next/server'
import { z } from 'zod'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'
import { readJsonLimited } from '@trainingai/shared/http/request-guards'

// 400 entries of a 200-char name plus a number is ~90 KB at the schema's own limit.
const MAX_BODY_BYTES = 256 * 1024

// The starting 1RMs a user types in the program builder. Formerly
// `POST /api/personal-records/seed`, which wrote `personal_records` — conflating a typed
// estimate with an earned record, and rewriting real PRs every time a program was reviewed
// (Q-5). The values now land in `exercise_estimates`, which the shared basis resolver reads.
const BodySchema = z.object({
  entries: z.array(z.object({
    exerciseName: z.string().trim().min(1).max(200),
    estimated1rm: z.number().finite().positive().max(1000),
  })).max(400),
})

export async function POST(req: Request) {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const read = await readJsonLimited(req, MAX_BODY_BYTES)
  if (!read.ok) {
    return read.reason === 'too_large'
      ? NextResponse.json({ error: 'Request too large' }, { status: 413 })
      : NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }
  const parsed = BodySchema.safeParse(read.body)
  if (!parsed.success) return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })

  const { entries } = parsed.data
  if (entries.length === 0) return NextResponse.json({ ok: true })

  const repo = await getRepository()
  await Promise.all(
    entries.map(e => repo.upsertExerciseEstimate(userId, e.exerciseName.trim(), e.estimated1rm)),
  )

  return NextResponse.json({ ok: true })
}
