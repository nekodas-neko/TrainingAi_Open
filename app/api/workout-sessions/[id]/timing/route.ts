import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'
import { rateLimit } from '@/lib/rate-limit'
import { setWorkSec, transitionSecForEquipment } from '@trainingai/shared/workout/duration-model'
import { errorLog } from '@trainingai/shared/logger'
import { reportServerError } from '@/lib/observability'

export interface ExerciseTiming {
  name: string
  setupActualSec: number | null  // measured bar-load / prep time before the first set
  setupExpectedSec: number       // equipment-based transition estimate
  workActualSec: number | null   // Σ measured set time
  workExpectedSec: number        // Σ model-expected set-work time (10s setup + 4s/rep)
  restActualSec: number | null   // Σ measured rest between sets (incl. the last set's rest)
  restExpectedSec: number        // Σ prescribed rest
}

// Where each "expected" value comes from — surfaced in the UI so the target is never a mystery.
export interface TimingSources {
  setup: string
  work: string
  rest: string
}

export interface SessionTimingResponse {
  hasData: boolean
  exercises: ExerciseTiming[]
  totals: {
    setupActualSec: number | null
    setupExpectedSec: number
    workActualSec: number | null
    workExpectedSec: number
    restActualSec: number | null
    restExpectedSec: number
  }
  sources: TimingSources
}

const SOURCES: TimingSources = {
  setup: 'typical for the equipment',
  work: 'a standard set pace (10s + 4s/rep)',
  rest: 'your prescribed rest',
}

const EMPTY: SessionTimingResponse = {
  hasData: false,
  exercises: [],
  totals: { setupActualSec: null, setupExpectedSec: 0, workActualSec: null, workExpectedSec: 0, restActualSec: null, restExpectedSec: 0 },
  sources: SOURCES,
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth()
    const userId = session?.user?.id
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!rateLimit(`session-timing:${userId}`, 30, 60_000)) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
    }

    const { id: sessionId } = await params
    const repo = await getRepository()
    const ws = await repo.getWorkoutSessionDetail(userId, sessionId)
    if (!ws) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    // Equipment per exercise → the expected setup (bar-load) time, via the shared duration model.
    const library = await repo.listExerciseLibrary()
    const equipByName = new Map(library.map(e => [e.name.toLowerCase(), e.equipment]))

    let anyTiming = false
    const exercises: ExerciseTiming[] = ws.exercises.map(ex => {
      let workActual = 0, workActualSeen = false
      let restActual = 0, restActualSeen = false
      let workExpected = 0, restExpected = 0
      for (const st of ex.sets) {
        workExpected += setWorkSec(st.reps)
        if (st.setTimeSec != null) { workActual += st.setTimeSec; workActualSeen = true }
        if (st.restTimeSec != null) { restActual += st.restTimeSec; restActualSeen = true }
        if (st.plannedRestSec != null) restExpected += st.plannedRestSec
      }
      const setupActual = ex.prepTimeSec ?? null
      if (workActualSeen || restActualSeen || setupActual != null) anyTiming = true
      return {
        name: ex.exerciseName,
        setupActualSec: setupActual,
        setupExpectedSec: transitionSecForEquipment(equipByName.get(ex.exerciseName.toLowerCase())),
        workActualSec: workActualSeen ? workActual : null,
        workExpectedSec: workExpected,
        restActualSec: restActualSeen ? restActual : null,
        restExpectedSec: restExpected,
      }
    })

    const sumActual = (pick: (e: ExerciseTiming) => number | null): number | null => {
      const vals = exercises.map(pick).filter((v): v is number => v != null)
      return vals.length > 0 ? vals.reduce((a, b) => a + b, 0) : null
    }
    const sumExpected = (pick: (e: ExerciseTiming) => number): number => exercises.reduce((a, e) => a + pick(e), 0)

    const body: SessionTimingResponse = anyTiming
      ? {
          hasData: true,
          exercises,
          totals: {
            setupActualSec: sumActual(e => e.setupActualSec),
            setupExpectedSec: sumExpected(e => e.setupExpectedSec),
            workActualSec: sumActual(e => e.workActualSec),
            workExpectedSec: sumExpected(e => e.workExpectedSec),
            restActualSec: sumActual(e => e.restActualSec),
            restExpectedSec: sumExpected(e => e.restExpectedSec),
          },
          sources: SOURCES,
        }
      : EMPTY

    return NextResponse.json(body, {
      headers: { 'Cache-Control': 'private, no-store' },
    })
  } catch (error) {
    reportServerError(error, { url: '/api/workout-sessions/[id]/timing' })
    const errMsg = errorLog(error, 'GET /api/workout-sessions/[id]/timing')
    return NextResponse.json({ error: errMsg }, { status: 500 })
  }
}
