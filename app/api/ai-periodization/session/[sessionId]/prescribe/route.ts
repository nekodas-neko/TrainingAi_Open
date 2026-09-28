import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'
import { DEFAULT_TZ } from '@trainingai/shared/date-utils'
import { rateLimit } from '@/lib/rate-limit'
import { generatePrescriptionForSession } from '@trainingai/shared/ai-periodization/generate-prescription'
import { refitPrescriptionToBudget } from '@trainingai/shared/ai-periodization/refit-prescription'
import { z } from 'zod'
import { invalidUuidResponse } from '@/lib/api/route-errors'
import { readJsonLimited } from '@trainingai/shared/http/request-guards'

// Optional prescription overrides.
/**
 * The model's hourly allowance. Ten was the original figure, when generation was automatic-only —
 * one per session open or completion. At ~3.4k tokens a call, twenty stays well inside the free
 * tier, and the dedup cache collapses the open-burst the first limit was sized against.
 */
const PRESCRIBE_MODEL_PER_HOUR = 20
/**
 * The ceiling over every prescribe request, model or not. Higher than the model's, because a
 * duration re-fit costs no tokens — but not unlimited: the re-fit still runs a full
 * `aggregateSignals`, which is ~30 repository reads, so it needs a real bound of its own.
 */
const PRESCRIBE_ANY_PER_HOUR = 60

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

  // TWO buckets, because two very different things arrive here (LA-147).
  //
  // This one is the outer ceiling and it is checked FIRST, before the body is even read, so an
  // abusive caller cannot spend anything — not a parse, not a repository read — by omitting the
  // field that decides the branch. It bounds every prescribe request regardless of kind.
  if (!rateLimit(`prescribe-any:${userId}`, PRESCRIBE_ANY_PER_HOUR, 60 * 60 * 1000)) {
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

  // A duration change does not need the model. The plan it would produce is the stored one
  // re-fitted to a different budget, and that fit is deterministic arithmetic — asking Gemini
  // again cost ~30 s of "Preparing your AI workout…" and a token spend for nothing (RV-202 ②).
  // Anything the stored plan cannot answer — no prescription yet, one generated before the
  // baseline existed, an expired or finished one, a whole-session deload — falls through to the
  // full generation below, which is what used to run every time.
  if (durationPreset != null) {
    const refit = await refitPrescriptionToBudget(userId, programSessionId, repo, tz, durationPreset)
    if (refit.ok) {
      return NextResponse.json({
        prescription: refit.prescription,
        prescriptionStatus: refit.prescriptionStatus,
        estimatedSessionDurationMin: refit.estimatedSessionDurationMin,
        durationPreset: refit.prescription.durationPreset ?? 'standard',
      })
    }
  }

  // The model's own budget, spent only on the branch that actually reaches it.
  //
  // Before LA-147 this was the single limit, and RV-202 ② made it wrong: a duration change stopped
  // calling the model but kept spending its allowance, so twenty preset switches in an hour
  // produced "Too many requests" for work the AI never saw. The limit's own comment cited
  // preset-switching as the reason it was 20 rather than 10 — that justification moved here with
  // the model call.
  //
  // A preset request that FALLS THROUGH (no stored plan, expired, a pending whole-session deload)
  // reaches this and is charged, which is right: it is about to run a real generation.
  if (!rateLimit(`prescribe:${userId}`, PRESCRIBE_MODEL_PER_HOUR, 60 * 60 * 1000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

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
