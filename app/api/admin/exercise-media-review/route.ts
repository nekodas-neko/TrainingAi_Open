import { NextResponse } from 'next/server'
import { z } from 'zod'
import { auth } from '@/auth'
import { requireAdmin, adminErrorResponse } from '@/lib/admin'
import { rateLimit } from '@/lib/rate-limit'
import { getDb, ensureSchema } from '@/lib/data/postgres/client'
import { exerciseMedia } from '@/lib/data/postgres/schema'
import { and, eq, ne } from 'drizzle-orm'
import { readJsonLimited } from '@trainingai/shared/http/request-guards'
import { invalidBodyResponse } from '@/lib/api/route-errors'

/**
 * BF-147 — record whether a generated GIF actually shows the exercise.
 *
 * The owner asked for *"a way to flag if its wrong so we can decide how to proceed"*. "So we can
 * decide" is a **set**, not a toast, so this writes a verdict and the GET hands back the collected
 * ones. Nothing here regenerates anything: marking a GIF wrong must not fire an AI call, because
 * collecting the wrong ones is the whole point of collecting them.
 *
 * Keyed on `(exerciseName, gender)` — `exercise_media`'s own unique key — rather than on a row id,
 * so the caller names the thing it is judging rather than a row it had to look up first.
 */
const MAX_BODY_BYTES = 4 * 1024

const REVIEW_STATUSES = ['unreviewed', 'ok', 'wrong'] as const

const BodySchema = z.object({
  exerciseName: z.string().min(1).max(120),
  gender: z.enum(['male', 'female']).optional(),
  status: z.enum(REVIEW_STATUSES),
}).strict()

/** The flagged set: what the owner asked to be able to decide about. */
export async function GET() {
  const session = await auth()
  try {
    await requireAdmin(session?.user?.id ?? '', session?.user?.isAdmin)
  } catch (err) {
    return adminErrorResponse(err)
  }

  await ensureSchema()
  const rows = await getDb()
    .select({
      exerciseName: exerciseMedia.exerciseName,
      gender: exerciseMedia.gender,
      gifUrl: exerciseMedia.gifUrl,
      reviewStatus: exerciseMedia.reviewStatus,
      reviewedAt: exerciseMedia.reviewedAt,
      modelUsed: exerciseMedia.modelUsed,
    })
    .from(exerciseMedia)
    // Matches the partial index the migration adds; `unreviewed` is the majority and is not news.
    .where(ne(exerciseMedia.reviewStatus, 'unreviewed'))

  return NextResponse.json(
    { reviewed: rows },
    { headers: { 'Cache-Control': 'private, no-store' } },
  )
}

export async function PATCH(req: Request) {
  const session = await auth()
  try {
    await requireAdmin(session?.user?.id ?? '', session?.user?.isAdmin)
  } catch (err) {
    return adminErrorResponse(err)
  }

  // Matches the sibling media routes' limit (Q-134). Cheap by comparison — no generation — but a
  // runaway client loop is the same mis-click exposure, and a limit costs nothing to keep uniform.
  if (!rateLimit(`admin-media-review:${session?.user?.id ?? 'anon'}`, 60, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  const read = await readJsonLimited(req, MAX_BODY_BYTES)
  if (!read.ok) {
    return read.reason === 'too_large'
      ? NextResponse.json({ error: 'Request too large' }, { status: 413 })
      : NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = BodySchema.safeParse(read.body)
  if (!parsed.success) return invalidBodyResponse(parsed.error)

  const { exerciseName, gender = 'male', status } = parsed.data

  await ensureSchema()
  // No upsert: a verdict about a GIF that does not exist is not a verdict, and creating a media row
  // from a review call would invent provenance (`model_used` null, `generated_at` now) for a
  // generation that never happened.
  const updated = await getDb()
    .update(exerciseMedia)
    .set({ reviewStatus: status, reviewedAt: status === 'unreviewed' ? null : new Date() })
    .where(and(eq(exerciseMedia.exerciseName, exerciseName), eq(exerciseMedia.gender, gender)))
    .returning({ exerciseName: exerciseMedia.exerciseName })

  if (updated.length === 0) {
    return NextResponse.json({ error: 'No media for that exercise' }, { status: 404 })
  }

  return NextResponse.json(
    { ok: true, exerciseName, gender, status },
    { headers: { 'Cache-Control': 'private, no-store' } },
  )
}
