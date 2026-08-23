import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'
import { z } from 'zod'
import type { Baseline1rmEntry } from '@trainingai/shared/types/ai-periodization'
import { readJsonLimited } from '@trainingai/shared/http/request-guards'

// A baseline completion marker.
const MAX_BODY_BYTES = 8 * 1024

// The only real caller (ai-periodization-status-card.tsx) always sends
// useExisting:true — there was never a client posting real amrapResults (the actual AMRAP
// baseline runs client-side during the session and completes via a different path). Deleted
// the dead branch rather than fixing its schema (YAGNI).
const BodySchema = z.object({
  sessionId: z.string().uuid(),
})

export async function POST(req: NextRequest) {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: z.infer<typeof BodySchema>
  try {
    const read = await readJsonLimited(req, MAX_BODY_BYTES)
    if (!read.ok) {
      return read.reason === 'too_large'
        ? NextResponse.json({ error: 'Request too large' }, { status: 413 })
        : NextResponse.json({ error: 'Invalid body' }, { status: 400 })
    }
    body = BodySchema.parse(read.body)
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const { sessionId } = body
  const repo = await getRepository()

  const existingState = await repo.getSessionPeriodization(userId, sessionId)
  if (existingState?.baselineComplete) {
    return NextResponse.json({ error: 'Baseline already complete' }, { status: 409 })
  }

  await repo.ensureSessionPeriodization(userId, sessionId)

  const baseline1rm: Record<string, Baseline1rmEntry> = {}

  // Build the baseline from existing PRs, keyed by this session's exercise ids (the
  // periodization signals look baseline up by session-exercise id, not name). If none of
  // the session's exercises have a PR there's nothing to seed — tell the caller to run a
  // real AMRAP baseline instead of silently completing with an empty, unusable anchor.
  const [prMap, program, estimates] = await Promise.all([
    repo.listPersonalRecords(userId),
    repo.getActiveProgram(userId),
    repo.getExerciseEstimates(userId).catch(() => []),
  ])
  // Q-5: `personal_records` is log-derived, so a brand-new user has none — the starting 1RMs
  // they typed in the builder now live in `exercise_estimates`. Without this the skip-baseline
  // flow became unreachable for exactly the users it exists for. Tagged so the prescription
  // prompt can tell an earned number from a typed one.
  const estimateMap = new Map(estimates.map(e => [e.exerciseName, e.estimated1rm]))
  const programSession = program?.sessions.find(s => s.id === sessionId)
  if (!programSession) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  for (const ex of programSession.exercises) {
    const pr = prMap.get(ex.exerciseName)
    if (pr != null) {
      baseline1rm[ex.id] = { kg: pr, source: 'existing' }
      continue
    }
    const estimate = estimateMap.get(ex.exerciseName)
    if (estimate != null) baseline1rm[ex.id] = { kg: estimate, source: 'estimate' }
  }
  if (Object.keys(baseline1rm).length === 0) {
    return NextResponse.json(
      { error: 'No prior data for these exercises — start the session to run a quick AMRAP baseline instead.', code: 'no_prior_data' },
      { status: 400 },
    )
  }

  await repo.setBaselineComplete(userId, sessionId, baseline1rm)

  // Fire prescription generation (best effort)
  let prescription = null
  try {
    const origin = req.nextUrl.origin
    const prescribeRes = await fetch(
      `${origin}/api/ai-periodization/session/${sessionId}/prescribe`,
      {
        method: 'POST',
        headers: { cookie: req.headers.get('cookie') ?? '' },
      },
    )
    if (prescribeRes.ok) {
      const data = await prescribeRes.json()
      prescription = data.prescription ?? null
    }
  } catch (err) {
    console.error('Baseline prescription generation failed (non-fatal):', err)
  }

  return NextResponse.json({ baseline1rm, prescription })
}
