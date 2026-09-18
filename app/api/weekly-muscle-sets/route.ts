import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { sql } from 'drizzle-orm'
import { getDb, ensureSchema } from '@/lib/data/postgres/client'
import { getRepository } from '@/lib/data'
import { formatInTimeZone, fromZonedTime, toZonedTime } from 'date-fns-tz'
import { DEFAULT_TZ, todayInTz } from '@trainingai/shared/date-utils'
import { normalizeMuscle } from '@trainingai/shared/muscles'
import { weeklyVolumeTarget, phaseVolumeScale } from '@trainingai/shared/ai-periodization/volume-targets'

export interface MuscleSetsEntry {
  muscle: string
  sets: number
  // The active program's weekly set target for this muscle, when one is configured.
  // Absent → the card falls back to its generic 10–20 band.
  //
  // BF-59: DERIVED from `volumeLandmarks(goal, muscle)` and the week's phase mix, not read from
  // `program_volume_targets.target_sets_per_week`. Those rows were seeded once and never corrected,
  // so production holds a flat 14/10 binary that ignores both the per-muscle landmark table and the
  // program's goal multiplier. The stored row still supplies WHICH muscles the program trains; its
  // number is no longer read.
  target?: number
}

/**
 * Why this week's targets are what they are (BF-59).
 *
 * The card prints this rather than showing a target that silently moved: a peaking week's target is
 * meant to be lower, and a number that drops with nothing on screen explaining it is its own kind
 * of wrong. `dominant` is the phase carrying the most of the week's sessions; `scale` is the
 * multiplier those sessions produced.
 */
export interface WeeklyPhaseContext {
  scale: number
  dominant: string | null
  counts: Record<string, number>
}

export interface WeeklyMuscleSetsResponse {
  muscles: MuscleSetsEntry[]
  weekStart: string
  /** Absent when the user has no active program — there is nothing to scale. */
  phase?: WeeklyPhaseContext
}

export async function GET() {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  await ensureSchema()
  const tz = session.user.timezone ?? DEFAULT_TZ
  const nowZoned = toZonedTime(new Date(), tz)
  const daysFromMonday = (nowZoned.getDay() + 6) % 7
  const mondayZoned = new Date(nowZoned)
  mondayZoned.setDate(mondayZoned.getDate() - daysFromMonday)
  mondayZoned.setHours(0, 0, 0, 0)
  const weekStartUtc = fromZonedTime(mondayZoned, tz)

  const db = getDb()

  // LA-118 — this used to carry its own copy of the attribution SQL, one of four that agreed on the
  // 1.0/0.5 weighting and disagreed on everything else. It now reads the shared query, which also
  // gives it the **upper bound it never had**: it was `el.logged_at >= weekStart` and nothing else,
  // so a log dated in the future counted toward this week forever. Nothing writes future logs
  // today, and the sync path takes a client-supplied `logged_at`, so nothing structurally stopped
  // one.
  //
  // Unscoped by programme on purpose, which is what it always did — this card shows what the lifter
  // trained this week, not what one programme's sessions contributed.
  const repo = await getRepository()
  const weekStartStr = formatInTimeZone(weekStartUtc, tz, 'yyyy-MM-dd')
  const muscleTotals = new Map(
    Object.entries(await repo.getSetsByMuscleInWindow(userId, weekStartStr, todayInTz(tz), tz)),
  )

  const rawMuscles = [...muscleTotals.entries()]
    .map(([muscle, sets]) => ({ muscle, sets }))
    .sort((a, b) => b.sets - a.sets)

  // Overlay the active program's per-muscle weekly targets so this single card shows progress
  // toward the program's real targets (replacing the separate "Weekly Volume vs Target" card).
  // Union logged muscles with target muscles so an under-trained (0-set) target still appears.
  const program = await repo.getActiveProgram(userId)
  const targets = program ? await repo.listVolumeTargets(userId, program.id) : []
  // The stored rows are the ROSTER of muscles this program trains. Their stored numbers are not
  // read any more — see MuscleSetsEntry.target.
  const targetMuscles = new Set(targets.map(t => normalizeMuscle(t.muscleGroup)))

  // BF-59. The week's phase mix, from the sessions actually trained in it. Weighted by workout
  // session rather than by distinct program session, because training a session twice in a week is
  // two sessions' worth of that phase's volume.
  //
  // **Trained rather than scheduled, deliberately.** The bar compares THIS WEEK'S LOGGED SETS
  // against the target, so the target has to reflect the sessions those sets came from. Early in
  // the week nothing is logged and the list is empty, which scales by 1 — the accumulation
  // baseline, and exactly what the card showed before this existed.
  const phaseRows = program ? await db.execute<{ program_session_id: string }>(sql`
    SELECT ws.program_session_id
    FROM workout_sessions ws
    WHERE ws.user_id = ${userId}::uuid
      AND ws.started_at >= ${weekStartUtc.toISOString()}
      AND ws.program_session_id IS NOT NULL
      AND ws.deleted_at IS NULL
  `) : { rows: [] as { program_session_id: string }[] }
  const periodization = program ? await repo.listSessionPeriodizationForProgram(userId, program.id) : []
  const phaseBySession = new Map(periodization.map(p => [p.programSessionId, p.phase as string]))
  const weekPhases = phaseRows.rows
    .map(r => phaseBySession.get(r.program_session_id))
    .filter((p): p is string => !!p)
  const phase = phaseVolumeScale(weekPhases)
  const goal = program?.trainingGoal ?? 'strength'

  let muscles: MuscleSetsEntry[]
  if (targetMuscles.size > 0) {
    const loggedMap = new Map(rawMuscles.map(r => [r.muscle, r.sets]))
    const all = new Set<string>([...loggedMap.keys(), ...targetMuscles])
    muscles = [...all]
      .map(m => ({
        muscle: m,
        sets: loggedMap.get(m) ?? 0,
        target: targetMuscles.has(m) ? weeklyVolumeTarget(goal, m, weekPhases) : undefined,
      }))
      .sort((a, b) => (b.target ?? 0) - (a.target ?? 0) || b.sets - a.sets)
  } else {
    muscles = rawMuscles
  }

  return NextResponse.json({
    muscles,
    weekStart: weekStartStr,
    ...(program ? { phase } : {}),
  } satisfies WeeklyMuscleSetsResponse, { headers: { "Cache-Control": "private, no-store" } })
}
