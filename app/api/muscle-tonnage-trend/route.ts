import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { sql } from 'drizzle-orm'
import { getDb, ensureSchema } from '@/lib/data/postgres/client'
import { DEFAULT_TZ, todayInTz, shiftDateStr, startOfWeekInTz } from '@trainingai/shared/date-utils'
import { normalizeMuscle } from '@trainingai/shared/muscles'

const WEEKS = 6

export interface MuscleTonnageTrendResponse {
  // Oldest → newest, one entry per week (Monday date, local tz)
  weekStarts: string[]
  // muscle name -> tonnage (kg) per week, same order/length as weekStarts
  muscles: Record<string, number[]>
}

export async function GET() {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  await ensureSchema()
  const tz = session.user.timezone ?? DEFAULT_TZ
  const thisWeekStart = startOfWeekInTz(tz)
  const weekStarts = Array.from({ length: WEEKS }, (_, i) => shiftDateStr(thisWeekStart, -7 * (WEEKS - 1 - i)))
  const rangeStart = weekStarts[0]
  const rangeEndExclusive = shiftDateStr(todayInTz(tz), 1)

  const db = getDb()
  // Bucket by the LOCAL calendar date (not the raw UTC timestamp) before computing
  // the week offset — a plain `logged_at::date` truncation would misattribute
  // rows near local midnight to the wrong day/week for any non-UTC timezone.
  // Same main/secondary role weighting as getWeeklySetsByMuscleGroup (periodization.ts)
  // and weekly-muscle-sets/route.ts — secondary-muscle tonnage counts at half weight.
  const libRows = await db.execute<{ muscle: string; week_start: string; tonnage_kg: number }>(sql`
    SELECT
      LOWER(muscle_entry->>'muscle') AS muscle,
      to_char(
        ${rangeStart}::date + ((to_char((el.logged_at AT TIME ZONE ${tz}), 'YYYY-MM-DD')::date - ${rangeStart}::date) / 7) * 7,
        'YYYY-MM-DD'
      ) AS week_start,
      SUM((sl.weight_kg * sl.reps) * CASE WHEN muscle_entry->>'role' = 'main' THEN 1.0 ELSE 0.5 END)::float AS tonnage_kg
    FROM exercise_logs el
    JOIN workout_sessions ws ON ws.id = el.workout_session_id
    JOIN set_logs sl ON sl.exercise_log_id = el.id
    CROSS JOIN LATERAL jsonb_array_elements(
      (SELECT muscles FROM exercise_library WHERE name = el.exercise_name)
    ) AS muscle_entry
    WHERE ws.user_id = ${userId}::uuid
      AND to_char((el.logged_at AT TIME ZONE ${tz}), 'YYYY-MM-DD') >= ${rangeStart}
      AND to_char((el.logged_at AT TIME ZONE ${tz}), 'YYYY-MM-DD') < ${rangeEndExclusive}
      AND EXISTS (SELECT 1 FROM exercise_library WHERE name = el.exercise_name)
      AND el.deleted_at IS NULL AND ws.deleted_at IS NULL AND sl.deleted_at IS NULL
    GROUP BY muscle, week_start
  `)

  const nonLibRows = await db.execute<{ muscle: string; week_start: string; tonnage_kg: number }>(sql`
    SELECT
      LOWER(mg) AS muscle,
      to_char(
        ${rangeStart}::date + ((to_char((el.logged_at AT TIME ZONE ${tz}), 'YYYY-MM-DD')::date - ${rangeStart}::date) / 7) * 7,
        'YYYY-MM-DD'
      ) AS week_start,
      SUM(sl.weight_kg * sl.reps)::float AS tonnage_kg
    FROM exercise_logs el
    JOIN workout_sessions ws ON ws.id = el.workout_session_id
    JOIN set_logs sl ON sl.exercise_log_id = el.id
    CROSS JOIN LATERAL unnest(el.muscle_groups) AS mg
    WHERE ws.user_id = ${userId}::uuid
      AND to_char((el.logged_at AT TIME ZONE ${tz}), 'YYYY-MM-DD') >= ${rangeStart}
      AND to_char((el.logged_at AT TIME ZONE ${tz}), 'YYYY-MM-DD') < ${rangeEndExclusive}
      AND el.muscle_groups IS NOT NULL
      AND array_length(el.muscle_groups, 1) > 0
      AND NOT EXISTS (SELECT 1 FROM exercise_library WHERE name = el.exercise_name)
      AND el.deleted_at IS NULL AND ws.deleted_at IS NULL AND sl.deleted_at IS NULL
    GROUP BY muscle, week_start
  `)

  // Canonical keys, same as weekly-muscle-sets and getWeeklySetsByMuscleGroup — the raw library
  // label would draw one muscle as two separate trend lines ("core" and "abs").
  const muscles: Record<string, number[]> = {}
  for (const row of [...libRows.rows, ...nonLibRows.rows]) {
    if (!row.muscle) continue
    const weekIdx = weekStarts.indexOf(row.week_start)
    if (weekIdx === -1) continue
    const muscle = normalizeMuscle(row.muscle)
    if (!muscles[muscle]) muscles[muscle] = new Array(WEEKS).fill(0)
    muscles[muscle][weekIdx] += Number(row.tonnage_kg)
  }

  return NextResponse.json({
    weekStarts,
    muscles,
  } satisfies MuscleTonnageTrendResponse, { headers: { "Cache-Control": "private, no-store" } })
}
