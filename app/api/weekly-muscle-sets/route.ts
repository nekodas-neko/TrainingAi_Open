import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { sql } from 'drizzle-orm'
import { getDb, ensureSchema } from '@/lib/data/postgres/client'
import { getRepository } from '@/lib/data'
import { formatInTimeZone, fromZonedTime, toZonedTime } from 'date-fns-tz'
import { DEFAULT_TZ } from '@trainingai/shared/date-utils'
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
  // Secondary muscles (e.g. triceps on a bench press) count at half weight vs. the
  // exercise's main muscle(s) — matches the weighting used by the AI periodization engine
  // (lib/data/postgres/slices/periodization.ts getWeeklySetsByMuscleGroup). Exercises with
  // no matching exercise_library entry fall back to full weight for every tagged muscle.
  const libResult = await db.execute<{ muscle: string; sets: number }>(sql`
    SELECT
      LOWER(muscle_entry->>'muscle') AS muscle,
      SUM(CASE WHEN muscle_entry->>'role' = 'main' THEN 1.0 ELSE 0.5 END)::float AS sets
    FROM exercise_logs el
    JOIN workout_sessions ws ON ws.id = el.workout_session_id
    JOIN set_logs sl ON sl.exercise_log_id = el.id
    CROSS JOIN LATERAL jsonb_array_elements(
      (SELECT muscles FROM exercise_library WHERE name = el.exercise_name)
    ) AS muscle_entry
    WHERE ws.user_id = ${userId}::uuid
      AND el.logged_at >= ${weekStartUtc.toISOString()}
      AND EXISTS (SELECT 1 FROM exercise_library WHERE name = el.exercise_name)
      AND el.deleted_at IS NULL AND ws.deleted_at IS NULL AND sl.deleted_at IS NULL
    GROUP BY muscle
  `)

  const nonLibResult = await db.execute<{ muscle: string; sets: number }>(sql`
    SELECT LOWER(mg) AS muscle, COUNT(sl.id)::float AS sets
    FROM exercise_logs el
    JOIN workout_sessions ws ON ws.id = el.workout_session_id
    JOIN set_logs sl ON sl.exercise_log_id = el.id
    CROSS JOIN LATERAL unnest(el.muscle_groups) AS mg
    WHERE ws.user_id = ${userId}::uuid
      AND el.logged_at >= ${weekStartUtc.toISOString()}
      AND el.muscle_groups IS NOT NULL
      AND array_length(el.muscle_groups, 1) > 0
      AND NOT EXISTS (SELECT 1 FROM exercise_library WHERE name = el.exercise_name)
      AND el.deleted_at IS NULL AND ws.deleted_at IS NULL AND sl.deleted_at IS NULL
    GROUP BY muscle
  `)

  // Fold synonyms to canonical names before tallying — program_volume_targets is written
  // canonically by computeDefaultVolumeTargets, so keying logged sets by the raw library label
  // painted one muscle as two rows ("Abs 0/16" in red beside an untargeted "Core 12").
  const muscleTotals = new Map<string, number>()
  for (const row of [...libResult.rows, ...nonLibResult.rows]) {
    if (!row.muscle) continue
    const muscle = normalizeMuscle(row.muscle)
    muscleTotals.set(muscle, (muscleTotals.get(muscle) ?? 0) + Number(row.sets))
  }
  const rawMuscles = [...muscleTotals.entries()]
    .map(([muscle, sets]) => ({ muscle, sets }))
    .sort((a, b) => b.sets - a.sets)

  // Overlay the active program's per-muscle weekly targets so this single card shows progress
  // toward the program's real targets (replacing the separate "Weekly Volume vs Target" card).
  // Union logged muscles with target muscles so an under-trained (0-set) target still appears.
  const repo = await getRepository()
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
    weekStart: formatInTimeZone(weekStartUtc, tz, 'yyyy-MM-dd'),
    ...(program ? { phase } : {}),
  } satisfies WeeklyMuscleSetsResponse, { headers: { "Cache-Control": "private, no-store" } })
}
