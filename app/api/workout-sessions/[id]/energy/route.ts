import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'
import { rateLimit } from '@/lib/rate-limit'
import { errorLog } from '@trainingai/shared/logger'
import { estSessionKcal, isKnownActivity, DEFAULT_ACTIVITY_ID, type Sex } from '@trainingai/shared/health/workout-energy'
import { reportServerError } from '@/lib/observability'
import { invalidUuidResponse } from '@/lib/api/route-errors'
import { ageFromDob } from '@trainingai/shared/date-utils'

// Estimated per-workout active energy: heart rate when the session has one, Oura's MET fallback
// otherwise. Deterministic — duration + intensity (RPE) + the user's profile → kcal.
// `durationMin`/`rpe` come from the client (authoritative, and avoids depending on completion having
// synced to the server yet); the server verifies session ownership and supplies the profile, the
// heart rate and the formula, which is `estSessionKcal` — the same one the day's energy budget runs.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth()
    const userId = session?.user?.id
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    if (!rateLimit(`workout-energy:${userId}`, 60, 60 * 1000)) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
    }

    const { id: sessionId } = await params
    const badId = invalidUuidResponse(sessionId)
    if (badId) return badId
    const repo = await getRepository()

    const ws = await repo.getWorkoutSessionDetail(userId, sessionId)
    if (!ws) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const url = new URL(req.url)
    const rpeParam = url.searchParams.get('rpe')
    const durParam = url.searchParams.get('durationMin')
    const rpe = rpeParam != null && Number.isFinite(Number(rpeParam)) ? Number(rpeParam) : ws.sessionRpe ?? null
    const durationMin =
      durParam != null && Number.isFinite(Number(durParam)) && Number(durParam) > 0
        ? Number(durParam)
        : ws.completedAt
          ? (ws.completedAt.getTime() - ws.startedAt.getTime()) / 60_000
          : null

    // Q-330: the LATEST weight, not `getBodyMetricsBaseline`, which orders `asc(date)` and so returns
    // the first weight ever logged. This route estimates the calories of a session that just
    // finished, so anchoring it to a months-old figure is wrong and — worse — never converges: the
    // error grows with every kilogram gained or lost. `progress-summary` is the one caller for which
    // "baseline" is the right reading.
    //
    // Q-331: the day's energy budget estimates this same session from heart rate when it has one,
    // and this route did not — so a session with an `avg_bpm` was reported twice, by two different
    // formulas, on two screens. Same input, same estimator, both places.
    const [user, latestWeightKg, avgBpmBySession] = await Promise.all([
      repo.getUserById(userId),
      repo.getMostRecentConfirmedWeightKg(userId),
      repo.getAvgBpmBySession(userId, [sessionId]),
    ])
    const sexRaw = user?.sex
    const sex: Sex | null = sexRaw === 'male' || sexRaw === 'female' ? sexRaw : null
    // Q-331: `ageFromDob` rather than a private fractional-years helper, which is what this route
    // had. Keytel weights age at 0.2017 kJ/min per year, so 33 whole years against 33.18 fractional
    // ones moved a 55-minute session by 1 kcal — enough for the day screen and the done screen to
    // print different numbers for the same workout, which is the whole point of this pass.
    const ageYears = ageFromDob(user?.dateOfBirth ?? null, new Date())
    const weightKg = latestWeightKg

    // A profile gap (no DOB / non-binary sex / no logged weight) means we can't run Schofield —
    // return kcal: null with a reason so the client shows nothing rather than a wrong number.
    if (ageYears == null || sex == null || weightKg == null || durationMin == null) {
      const missing = [
        ageYears == null && 'date of birth',
        sex == null && 'sex',
        weightKg == null && 'body weight',
        durationMin == null && 'duration',
      ].filter(Boolean)
      return NextResponse.json(
        { kcal: null, reason: `missing ${missing.join(', ')}` },
        { headers: { 'Cache-Control': 'private, no-store' } },
      )
    }

    const activityParam = Number(url.searchParams.get('activityId'))
    const activityId = Number.isFinite(activityParam) && isKnownActivity(activityParam) ? activityParam : DEFAULT_ACTIVITY_ID
    const { kcal, source, intensity, met } = estSessionKcal({
      durationMin, rpe, avgBpm: avgBpmBySession.get(sessionId) ?? null, ageYears, weightKg, sex, activityId,
    })

    return NextResponse.json(
      {
        kcal: kcal != null ? Math.round(kcal) : null,
        intensity,
        source,
        // Null whenever the heart-rate estimate ran — no MET was consulted, and reporting one would
        // suggest it produced the number.
        met,
        activityId,
        durationMin: Math.round(durationMin),
      },
      { headers: { 'Cache-Control': 'private, no-store' } },
    )
  } catch (error) {
    reportServerError(error, { url: '/api/workout-sessions/[id]/energy' })
    // Q-483: `errorLog` returns `[ERROR]: ${error}`, and returning that as the body published the
    // whole failing statement — every column of `workout_sessions` — to the client. Measured on a
    // malformed id, which reaches the driver as 22P02. The log line above keeps the full detail and
    // `reportServerError` already banked it, so redacting the response costs no diagnostics.
    errorLog(error, 'GET /api/workout-sessions/[id]/energy')
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
