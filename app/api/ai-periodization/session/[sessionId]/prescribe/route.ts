import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'
import { DEFAULT_TZ } from '@trainingai/shared/date-utils'
import { rateLimit } from '@/lib/rate-limit'
import { generatePrescriptionForSession } from '@trainingai/shared/ai-periodization/generate-prescription'
import { z } from 'zod'
import { invalidUuidResponse } from '@/lib/api/route-errors'
import { readJsonLimited } from '@trainingai/shared/http/request-guards'

// Optional prescription overrides.
const MAX_BODY_BYTES = 16 * 1024

export const maxDuration = 30

// BF-7 PR 2b — the ladder is minutes now (30/45/60/90 around the session's own length), so this
// accepts a number. The three labels stay legal: they are what older clients send and what stored
// prescriptions carry, and `requestedBudgetMin` is the single place that resolves either form.
//
// The bounds are a request guard, not the model's floor. `MIN_PRESET_BUDGET_MIN` still clamps what
// is achievable inside `budgetForPreset`; what these stop is a nonsense minute count reaching the
// planner at all. The ceiling is a day, which no session is, and the floor is one minute rather
// than the model's 20 so that an under-floor request is CLAMPED with its direction intact rather
// than 400'd — dropping it would tell a lifter at the floor that their choice was malformed.
const MIN_REQUESTED_SESSION_MIN = 1
const MAX_REQUESTED_SESSION_MIN = 1440

const PrescribeBodySchema = z.object({
  excludeSessionId: z.string().optional(),
  durationPreset: z.union([
    z.number().int().min(MIN_REQUESTED_SESSION_MIN).max(MAX_REQUESTED_SESSION_MIN),
    z.enum(['short', 'standard', 'long']),
  ]).optional(),
}).strict()

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // 20/hour, not 10: generation used to be automatic-only (one per session open or
  // completion), but the duration picker makes it user-initiated — switching short →
  // standard → long to compare is three calls on its own, on top of the automatic ones.
  // At ~3.4k tokens a call this stays well inside the free tier, and the dedup cache
  // already collapses the open-burst that the original limit was sized against.
  if (!rateLimit(`prescribe:${userId}`, 20, 60 * 60 * 1000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  const { sessionId: programSessionId } = await params
  const badId = invalidUuidResponse(programSessionId)
  if (badId) return badId
  // excludeSessionId: the just-completed workout session id, when this call is fired from
  // complete-workout's post-completion hook — excluded from the hoursSinceLastSession gap so
  // a fresh completion can't self-trigger the emergency deload (W5 §4.2). Absent for
  // manual/GET-style prescribe calls.
  // durationPreset: a today-only time-budget choice from the pre-workout screen.
  // Optional body — the manual/GET-style prescribe calls send none — so an absent or unreadable
  // one still falls back to {} and reaches the schema; only an oversized one is refused.
  const read = await readJsonLimited(req, MAX_BODY_BYTES)
  if (!read.ok && read.reason === 'too_large') {
    return NextResponse.json({ error: 'Request too large' }, { status: 413 })
  }
  const body = (read.ok ? read.body : null) ?? {}
  const parsed = PrescribeBodySchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  const { excludeSessionId, durationPreset } = parsed.data
  const repo = await getRepository()
  const tz = session.user?.timezone ?? DEFAULT_TZ

  // All generation/validation/persistence lives in the shared function so the
  // workout-completion path (lib/workout/complete-workout.ts) can regenerate the
  // next prescription in-process the moment a session ends — no self-origin HTTP hop.
  const result = await generatePrescriptionForSession(userId, programSessionId, repo, tz, excludeSessionId, durationPreset)
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })

  return NextResponse.json({
    prescription: result.prescription,
    prescriptionStatus: result.prescriptionStatus,
    estimatedSessionDurationMin: result.estimatedSessionDurationMin,
    durationPreset: result.prescription.durationPreset ?? 'standard',
  })
}
