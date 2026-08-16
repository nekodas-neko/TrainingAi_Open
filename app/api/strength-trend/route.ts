import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { sql } from 'drizzle-orm'
import { getDb, ensureSchema } from '@/lib/data/postgres/client'
import { getRepository } from '@/lib/data'
import { formatInTimeZone } from 'date-fns-tz'
import { DEFAULT_TZ } from '@trainingai/shared/date-utils'

export interface StrengthTrendEntry {
  name: string
  // A bodyweight `rm` is BW_REF-relative, so the client renders the whole series as a rep max
  // rather than kilograms (see lib/1rm.ts, finding Q-12).
  exerciseType: 'weighted' | 'bodyweight'
  history: { date: string; rm: number }[]
  currentRm: number
  peakRm: number
  startRm: number | null
  gainPct: number | null  // % change from first to last data point
}

export interface StrengthTrendResponse {
  exercises: StrengthTrendEntry[]
}

export async function GET() {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  await ensureSchema()
  const tz = session.user.timezone ?? DEFAULT_TZ

  const repo = await getRepository()
  const [program, library] = await Promise.all([repo.getActiveProgram(userId), repo.listExerciseLibrary()])
  const exerciseTypeByName = new Map(library.map(e => [e.name, e.exerciseType]))

  // Collect exercises from the active program (up to 12, deduped by name)
  const programExercises: string[] = []
  if (program) {
    for (const sess of program.sessions) {
      for (const ex of sess.exercises) {
        if (!programExercises.includes(ex.exerciseName)) {
          programExercises.push(ex.exerciseName)
        }
        if (programExercises.length >= 12) break
      }
      if (programExercises.length >= 12) break
    }
  }

  if (programExercises.length === 0) {
    return NextResponse.json({ exercises: [] } satisfies StrengthTrendResponse, { headers: { "Cache-Control": "private, no-store" } })
  }

  const db = getDb()
  const nameList = sql.join(programExercises.map(n => sql`${n}`), sql`, `)

  type RawRow = { exercise_name: string; session_date: string; rm: number }
  const result = await db.execute<RawRow>(sql`
    SELECT
      el.exercise_name,
      to_char((ws.started_at AT TIME ZONE ${tz}), 'YYYY-MM-DD') AS session_date,
      MAX(el.estimated_1rm)::double precision AS rm
    FROM exercise_logs el
    JOIN workout_sessions ws ON ws.id = el.workout_session_id
    WHERE ws.user_id = ${userId}::uuid
      AND el.exercise_name IN (${nameList})
      AND el.estimated_1rm IS NOT NULL
      AND el.estimated_1rm > 0
      AND ws.started_at >= NOW() - INTERVAL '90 days'
      AND el.deleted_at IS NULL AND ws.deleted_at IS NULL
    GROUP BY el.exercise_name, session_date
    ORDER BY el.exercise_name, session_date
  `)

  // Group by exercise, preserving program order
  const byExercise = new Map<string, { date: string; rm: number }[]>()
  for (const row of result.rows) {
    const arr = byExercise.get(row.exercise_name) ?? []
    arr.push({ date: row.session_date, rm: Number(row.rm) })
    byExercise.set(row.exercise_name, arr)
  }

  const exercises: StrengthTrendEntry[] = []
  for (const name of programExercises) {
    const history = byExercise.get(name)
    if (!history || history.length === 0) continue
    const rms = history.map(h => h.rm)
    const currentRm = rms[rms.length - 1]
    const peakRm = Math.max(...rms)
    const startRm = rms[0]
    const gainPct = history.length >= 2 && startRm > 0 ? Math.round(((currentRm - startRm) / startRm) * 100) : null
    exercises.push({
      name,
      exerciseType: exerciseTypeByName.get(name) ?? 'weighted',
      history, currentRm, peakRm, startRm, gainPct,
    })
  }

  // Sort by most recently trained so the carousel starts with the freshest exercise
  exercises.sort((a, b) => {
    const aLast = a.history[a.history.length - 1]?.date ?? ''
    const bLast = b.history[b.history.length - 1]?.date ?? ''
    return bLast.localeCompare(aLast)
  })

  return NextResponse.json({ exercises } satisfies StrengthTrendResponse, { headers: { "Cache-Control": "private, no-store" } })
}
