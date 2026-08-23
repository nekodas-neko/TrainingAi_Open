import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'
import { rateLimit } from '@/lib/rate-limit'
import { z } from 'zod'
import { DEFAULT_TZ, todayInTz, normalizeDateParam } from '@trainingai/shared/date-utils'
import { prescribeNextRun, OVERRIDE_RATIONALE_PREFIX } from '@trainingai/shared/running/prescription'
import { defaultFrameworkForGoal, CARDIO_GOALS } from '@trainingai/shared/running/cardio-goals'
import { weeklyZoneTargets } from '@trainingai/shared/running/zone-targets'
import { pacesFromVdot } from '@trainingai/shared/health/vdot'
import type { GateAction } from '@trainingai/shared/running/recovery-gate'
import type { GoalKind, Prescription, RunType } from '@trainingai/shared/running/types'
import { assembleInputs, resolveSnapshot, resolvePushContext } from '@trainingai/shared/running/assemble-plan-context'
import { readJsonLimited } from '@trainingai/shared/http/request-guards'

// A running plan.
const MAX_BODY_BYTES = 128 * 1024

// The prescription can now change multiple times within seconds via the run-type
// carousel's override calls, and a plain `fetch(url)` (no `cache` option — lib/sqlite/cache.ts's
// cachedFetchCore) fully honours a max-age response header at the BROWSER's HTTP cache layer,
// independent of and invisible to the app's own invalidateRunningPlan() cache-group system. That
// combination is exactly what let an override look like it "reverted" on reload within the same
// 60s window: the browser served its own stale cached GET response without ever reaching this
// handler. The app's cachedFetchToday + explicit invalidation already provides real caching with
// correct invalidation, so the extra HTTP-cache layer is redundant and actively wrong here.
const NO_STORE = 'private, no-store'

const CreateBody = z.object({
  goalKind: z.enum(['speed', 'endurance', 'heart_health', 'recovery', 'intervals', 'cardio_health', 'distance_event']).default('heart_health'),
  targetDistanceKm: z.number().positive().optional(),
  targetDate: z.string().optional(),
  frameworkKey: z.string().optional(),
  timePerSessionMinutes: z.number().int().positive().max(180).optional(),
// `.strict()` (Q-464): the one client, `components/running/plan-setup-sheet.tsx`, builds its body
// from `goalKind`, `targetDistanceKm`, `timePerSessionMinutes` and `frameworkKey` — all named here.
}).strict()

export async function GET() {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!rateLimit(`${userId}:running-plan`, 20, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }
  const tz = session.user?.timezone ?? DEFAULT_TZ
  const repo = await getRepository()

  const plan = await repo.getActiveRunningPlan(userId)
  if (!plan) return NextResponse.json({ plan: null, prescription: null }, { headers: { 'Cache-Control': NO_STORE } })

  const today = todayInTz(tz)
  const fitness = await resolveSnapshot(repo, userId, tz)

  // A row already exists for today whose rationale carries the override marker — the user
  // explicitly picked this structure via POST /api/running-plan/override. Recomputing fresh
  // here would silently flip the display back to the framework's original pick on the very
  // next reload, defeating the point of overriding. Trust the persisted row instead; it stays
  // authoritative until the day rolls over (getPrescribedRuns is date-scoped) or the run
  // completes. gateReasons (never persisted) come back empty — the override already ran
  // through the recovery gate once, and its outcome (gateAction) is what's persisted.
  const existingBeforeCompute = (await repo.getPrescribedRuns(userId, today, today))[0]
  if (existingBeforeCompute?.rationale?.startsWith(OVERRIDE_RATIONALE_PREFIX)) {
    const prescription: Prescription = {
      type: existingBeforeCompute.runType as RunType,
      durationMin: existingBeforeCompute.durationMin,
      distanceKm: existingBeforeCompute.distanceKm,
      targets: {
        zoneIds: existingBeforeCompute.targetZoneIds as Prescription['targets']['zoneIds'],
        hrLowBpm: existingBeforeCompute.targetHrLow ?? fitness.restingHr,
        hrHighBpm: existingBeforeCompute.targetHrHigh ?? fitness.maxHr,
      },
      rationale: existingBeforeCompute.rationale,
      frameworkKey: plan.frameworkKey,
    }
    const zoneTargets = weeklyZoneTargets(plan.frameworkKey, fitness.weeklyBaseMinutes)
    const goalMeta = CARDIO_GOALS[plan.goalKind as GoalKind] ?? null
    const goal = goalMeta ? { key: goalMeta.key, label: goalMeta.label, blurb: goalMeta.blurb } : null
    return NextResponse.json(
      {
        plan, prescription,
        gateAction: existingBeforeCompute.gateAction as GateAction, gateReasons: [],
        run: existingBeforeCompute, zoneTargets, goal, isPushSession: false,
      },
      { headers: { 'Cache-Control': NO_STORE } },
    )
  }

  const { ctx, gate } = await assembleInputs(repo, userId, tz, fitness, plan)
  const { prescription, gateAction, gateReasons } = prescribeNextRun(ctx, gate, plan.frameworkKey)

  const pushCtx = await resolvePushContext(repo, userId, plan, today, tz)
  if (pushCtx.isPush && pushCtx.bestDistanceKm != null && prescription.distanceKm != null) {
    prescription.distanceKm = Math.max(prescription.distanceKm, Math.round((pushCtx.bestDistanceKm * 1.02) * 100) / 100)
    prescription.rationale = `Push session — you've covered ${pushCtx.bestDistanceKm.toFixed(2)} km in this block's best outdoor run. Beat it: aim for ${prescription.distanceKm.toFixed(2)} km today.`
  }

  // Ensure today's prescribed_run row exists so completion has a stable id, but never
  // overwrite an existing row (its status may already be completed/skipped — clobbering
  // it would revert the user's action). Display uses the freshly-computed prescription;
  // completion targets the persisted row.
  const run = existingBeforeCompute ?? await repo.upsertPrescribedRun(userId, {
    id: crypto.randomUUID(), planId: plan.id, date: today,
    runType: prescription.type, durationMin: prescription.durationMin, distanceKm: prescription.distanceKm,
    targetHrLow: prescription.targets.hrLowBpm, targetHrHigh: prescription.targets.hrHighBpm,
    targetZoneIds: prescription.targets.zoneIds, rationale: prescription.rationale,
    gateAction, status: 'pending', activityLogId: null,
  })

  // This week's HR-zone time targets for the plan's framework + the goal blurb, so the UI
  // can show what the week should look like (not just today's single run).
  const zoneTargets = weeklyZoneTargets(plan.frameworkKey, fitness.weeklyBaseMinutes)
  const goalMeta = CARDIO_GOALS[plan.goalKind as GoalKind] ?? null
  const goal = goalMeta ? { key: goalMeta.key, label: goalMeta.label, blurb: goalMeta.blurb } : null

  return NextResponse.json(
    { plan, prescription, gateAction, gateReasons, run, zoneTargets, goal, isPushSession: pushCtx.isPush },
    { headers: { 'Cache-Control': NO_STORE } },
  )
}

export async function POST(req: Request) {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!rateLimit(`${userId}:running-plan`, 20, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }
  const read = await readJsonLimited(req, MAX_BODY_BYTES)
  if (!read.ok) {
    return read.reason === 'too_large'
      ? NextResponse.json({ error: 'Request too large' }, { status: 413 })
      : NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }
  const parsed = CreateBody.safeParse(read.body)
  if (!parsed.success) return NextResponse.json({ error: 'Invalid body' }, { status: 400 })

  const tz = session.user?.timezone ?? DEFAULT_TZ
  const repo = await getRepository()
  // Framework defaults from the chosen goal (speed→VO₂max intervals, heart_health→Zone 2,
  // recovery→aerobic, endurance→polarized); an explicit frameworkKey still overrides.
  const frameworkKey = parsed.data.frameworkKey ?? defaultFrameworkForGoal(parsed.data.goalKind)
  const fitness = await resolveSnapshot(repo, userId, tz)

  const plan = await repo.saveRunningPlan(userId, {
    goalKind: parsed.data.goalKind,
    targetDistanceKm: parsed.data.targetDistanceKm ?? null,
    targetDate: parsed.data.targetDate ? normalizeDateParam(parsed.data.targetDate) : null,
    frameworkKey,
    timePerSessionMinutes: parsed.data.timePerSessionMinutes ?? null,
    fitnessSnapshot: fitness,
    isActive: true,
  })

  const easyPaceSecPerKm = fitness.vo2max != null ? pacesFromVdot(fitness.vo2max).easySecPerKm : null
  await repo.saveRunningBaseline(userId, {
    planId: plan.id,
    vo2max: fitness.vo2max,
    maxHr: fitness.maxHr,
    restingHr: fitness.restingHr,
    thresholdHr: fitness.thresholdHr,
    weeklyBaseMinutes: fitness.weeklyBaseMinutes,
    easyPaceSecPerKm,
  })

  const { ctx, gate } = await assembleInputs(repo, userId, tz, fitness, plan)
  const { prescription, gateAction, gateReasons } = prescribeNextRun(ctx, gate, frameworkKey)

  const today = todayInTz(tz)
  // A just-created plan has zero completed sessions, so this is always false — resolved via the
  // same helper as GET (not hardcoded) so the two routes can never drift on the push-session rule.
  const pushCtx = await resolvePushContext(repo, userId, plan, today, tz)

  const run = await repo.upsertPrescribedRun(userId, {
    id: crypto.randomUUID(),
    planId: plan.id,
    date: today,
    runType: prescription.type,
    durationMin: prescription.durationMin,
    distanceKm: prescription.distanceKm,
    targetHrLow: prescription.targets.hrLowBpm,
    targetHrHigh: prescription.targets.hrHighBpm,
    targetZoneIds: prescription.targets.zoneIds,
    rationale: prescription.rationale,
    gateAction,
    status: 'pending',
    activityLogId: null,
  })

  return NextResponse.json({ plan, prescription, gateAction, gateReasons, run, isPushSession: pushCtx.isPush })
}
