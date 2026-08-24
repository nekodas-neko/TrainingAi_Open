import { NextResponse } from 'next/server'
import { z } from 'zod'
import { auth } from '@/auth'
import { getRepositoryAsync } from '@/lib/data'
import { rateLimit } from '@/lib/rate-limit'
import { CHOICE_SOURCES } from '@/lib/coach/widgets'
import { injurySafeAlternatives } from '@trainingai/shared/workout/injury-substitution'
import { errorLog } from '@trainingai/shared/logger'

const QuerySchema = z.object({
  source: z.enum(CHOICE_SOURCES),
  sourceId: z.string().min(1).optional(),
}).strict()

/**
 * The rows behind a Coach picker, read straight from the user's own data.
 *
 * **Why this route exists.** A picker used to be written out in full by the model — every id, name
 * and subtitle — which measured at ~554 output tokens, and output tokens are essentially all of
 * Coach's latency. That is paying a language model to transcribe a database it cannot see better
 * than we can. Now the model names a source and this returns the rows.
 *
 * Two consequences beyond speed: the model never authors an id for these lists, so the
 * invented-id bug class is impossible rather than forbidden; and the options are current at the
 * moment the widget renders instead of at the moment the model spoke.
 *
 * Read-only and user-scoped. Ownership comes from the session, never from `sourceId` — a client
 * that asks for another user's session id gets an empty list, not their exercises.
 */
export async function GET(req: Request) {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (!rateLimit(`${userId}:coach-options`, 60, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  const url = new URL(req.url)
  const parsed = QuerySchema.safeParse({
    source: url.searchParams.get('source'),
    sourceId: url.searchParams.get('sourceId') ?? undefined,
  })
  if (!parsed.success) return NextResponse.json({ error: 'Invalid source' }, { status: 400 })

  try {
    const repo = await getRepositoryAsync()
    const program = await repo.getActiveProgram(userId)
    if (!program) return NextResponse.json({ options: [] })

    if (parsed.data.source === 'sessions') {
      return NextResponse.json({
        options: program.sessions
          .slice()
          .sort((a, b) => a.position - b.position)
          .map(s => ({
            id: s.id,
            title: s.name,
            subtitle: `${s.exercises.length} exercise${s.exercises.length === 1 ? '' : 's'}`,
          })),
      })
    }

    if (parsed.data.source === 'exercises') {
      // No sourceId: every exercise in the program, labelled by session. The model asking for
      // "the exercises" without naming a session is a real case — the user said "change an
      // exercise" and never said which day.
      const sessions = parsed.data.sourceId
        ? program.sessions.filter(s => s.id === parsed.data.sourceId)
        : program.sessions
      return NextResponse.json({
        options: sessions
          .slice()
          .sort((a, b) => a.position - b.position)
          .flatMap(s =>
            s.exercises
              .slice()
              .sort((a, b) => a.position - b.position)
              .map(e => ({ id: e.id, title: e.exerciseName, subtitle: s.name })),
          )
          .slice(0, 24),
      })
    }

    // swap_candidates — same matcher the tool uses, so a suggestion is injury-aware here too.
    const current = program.sessions.flatMap(s => s.exercises).find(e => e.id === parsed.data.sourceId)
    if (!current) return NextResponse.json({ options: [] })

    const [library, injuries] = await Promise.all([repo.listExerciseLibrary(), repo.listInjuries(userId)])
    const entry = library.find(e => e.name === current.exerciseName)
    const mainMuscles = entry
      ? entry.muscles.filter(m => m.role === 'main').map(m => m.muscle)
      : current.muscleGroups

    return NextResponse.json({
      options: injurySafeAlternatives(
        { name: current.exerciseName, mainMuscles },
        injuries.filter(i => !i.resolvedDate).map(i => i.muscleName),
        library,
        24,
      ).map(e => ({
        id: e.id,
        title: e.name,
        subtitle: [e.equipment.join(' / '), e.muscles.filter(m => m.role === 'main').map(m => m.muscle).join(', ')]
          .filter(Boolean)
          .join(' • '),
      })),
    })
  } catch (error) {
    errorLog(error, 'API /coach/options')
    return NextResponse.json({ error: 'Could not load options' }, { status: 500 })
  }
}
