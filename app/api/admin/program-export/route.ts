import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'
import { requireAdmin, adminErrorResponse } from '@/lib/admin'
import { estimateExerciseDurationSec, transitionSecForEquipment } from '@trainingai/shared/workout/duration-model'
import {
  formatProgramExport,
  type ProgramExport,
  type ExportSession,
  type ExportSet,
} from '@/lib/admin/program-export'

// Admin-only, read-only export of the user's ACTIVE program — every session's exercises with
// role + the assigned progression style's sets/reps/pct/rest + muscles, plus an estimated vs
// budgeted duration per session. Meant to be copied and shared for programming review.
// GET ?format=text returns text/plain (readable/copyable in a browser); default returns JSON.
export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    await requireAdmin(session.user.id, session.user.isAdmin)
  } catch (err) {
    return adminErrorResponse(err)
  }

  const userId = session.user.id
  const repo = await getRepository()
  const program = await repo.getActiveProgram(userId)
  if (!program) return NextResponse.json({ error: 'No active program' }, { status: 404 })

  const styles = await repo.listProgressionStyles(userId)
  const styleById = new Map(styles.map(st => [st.id, st]))
  const allNames = [...new Set(program.sessions.flatMap(s => s.exercises.map(e => e.exerciseName)))]
  const equipmentMap = await repo.getExerciseEquipment(allNames)

  const sessions: ExportSession[] = program.sessions.map(s => {
    let durationSec = 0
    const exercises = s.exercises
      .slice()
      .sort((a, b) => a.position - b.position)
      .map(ex => {
        const style = ex.styleId ? styleById.get(ex.styleId) : undefined
        const styleSets = (style?.sets ?? [])
          .slice()
          .sort((a, b) => a.setNumber - b.setNumber)
        const sets: ExportSet[] = styleSets.map(ss => ({ reps: ss.reps, pct: ss.pct, restSec: ss.restSec }))

        // Representative reps/rest (mean of the style's sets) for the duration estimate — matches
        // how the app's own duration model treats an exercise as one reps/rest figure.
        if (sets.length > 0) {
          const meanReps = Math.round(sets.reduce((n, x) => n + x.reps, 0) / sets.length)
          const meanRest = Math.round(sets.reduce((n, x) => n + x.restSec, 0) / sets.length)
          durationSec += estimateExerciseDurationSec({
            sets: sets.length,
            reps: meanReps,
            restSec: meanRest,
            transitionSec: transitionSecForEquipment(equipmentMap[ex.exerciseName]),
          })
        }

        return {
          name: ex.exerciseName,
          role: ex.exerciseRole ?? 'primary',
          sets,
          muscles: ex.muscleGroups ?? [],
          supersetGroup: ex.supersetGroup ?? null,
        }
      })

    return {
      name: s.name,
      budgetMin: s.timeBudgetMinutes,
      estMin: Math.round(durationSec / 60),
      exercises,
    }
  })

  const data: ProgramExport = {
    programName: program.name,
    goal: program.trainingGoal,
    phaseMode: program.phaseMode,
    sessions,
  }
  const text = formatProgramExport(data)

  if (req.nextUrl.searchParams.get('format') === 'text') {
    return new NextResponse(text, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
  }
  return NextResponse.json({ text, program: data })
}
