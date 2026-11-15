import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { generateObject } from 'ai'
import { aiModel, loggedGenerateObject } from '@/lib/ai/instrument'
import { aiPausedResponse } from '@/lib/ai/provider-paused'
import { rateLimit } from '@/lib/rate-limit'
import { z } from 'zod'
import { reportServerError } from '@/lib/observability'
import { readJsonLimited } from '@trainingai/shared/http/request-guards'
import { PROSE_FIELD_GUARDS } from '@/lib/ai/prompt-guards'
import { getRepository } from '@/lib/data'
import { buildExerciseNameResolver } from '@trainingai/shared/workout/exercise-name-resolver'
import { equipmentLedByName } from '@trainingai/shared/workout/equipment'

// One exercise name, capped at 120 characters by the schema below.
const MAX_BODY_BYTES = 4 * 1024

const RequestSchema = z.object({
  name: z.string().min(1).max(120),
}).strict()

const MUSCLES = ['Chest', 'Shoulders', 'Triceps', 'Biceps', 'Forearms', 'Upper Back', 'Lats', 'Lower Back', 'Traps', 'Core', 'Quads', 'Hamstrings', 'Glutes', 'Calves', 'Adductors'] as const
const EQUIPMENT = ['barbell', 'dumbbell', 'cable', 'kettlebell', 'machine', 'bodyweight'] as const

const ExerciseGenSchema = z.object({
  normalizedName: z.string(),
  instructions: z.string(),
  muscles: z.array(z.object({ muscle: z.enum(MUSCLES), role: z.enum(['main', 'secondary']) })).min(1),
  equipment: z.array(z.enum(EQUIPMENT)).min(1),
})

const SYSTEM_PROMPT = `You are a fitness expert. Given an exercise name, return:
- normalizedName: the full proper name in Title Case — expand abbreviations (DB → Dumbbell, BB → Barbell, RDL → Romanian Deadlift, OHP → Overhead Press, etc.). If the input doesn't already specify equipment, prefix the name with the single most common equipment used to perform it (e.g. "Hip Thrust" → "Barbell Hip Thrust", "Bicep Curl" → "Dumbbell Bicep Curl", "Lateral Raise" → "Dumbbell Lateral Raise", "Leg Press" → "Machine Leg Press"). Only omit the prefix for exercises that are inherently bodyweight (e.g. "Push-Up", "Pull-Up", "Plank").
- instructions: 2-4 sentences explaining setup, form cues, and execution
- muscles: each with role "main" or "secondary"
- equipment: the equipment matching the name's prefix must be listed first. Only add further entries if the exercise is commonly performed interchangeably with near-identical form on that equipment (e.g. dumbbell/kettlebell goblet squats).

${PROSE_FIELD_GUARDS}`

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (!rateLimit(`exercise-gen:${session.user.id}`, 20, 60_000)) {
    return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 })
  }

  const read = await readJsonLimited(req, MAX_BODY_BYTES)
  if (!read.ok) {
    return read.reason === 'too_large'
      ? NextResponse.json({ error: 'Request too large' }, { status: 413 })
      : NextResponse.json({ error: 'Invalid input' }, { status: 400 })
  }
  const body = RequestSchema.safeParse(read.body)
  if (!body.success) return NextResponse.json({ error: 'Invalid body' }, { status: 400 })

  try {
    // #3751: a name the library already holds costs no model call. The resolver is the one the
    // program routes use (exact, normalised, word order; never a subset), so "bench press" finds
    // "Bench Press" and "Incline Bench Press" does not. Merged duplicates are not offered, as in
    // every picker (RV-51). `libraryId` tells the caller this is an existing row, not a draft.
    const library = (await (await getRepository()).listExerciseLibrary()).filter(ex => !ex.mergedInto)
    const existing = buildExerciseNameResolver(library).resolve(body.data.name)
    if (existing) {
      return NextResponse.json({
        normalizedName: existing.name,
        instructions: existing.instructions ?? '',
        muscles: existing.muscles,
        equipment: existing.equipment,
        libraryId: existing.id,
      })
    }

    const { object } = await loggedGenerateObject(
      { section: 'exercises-generate', userId: session.user.id, fingerprint: body.data.name },
      signal => generateObject({
        model: aiModel(),
        schema: ExerciseGenSchema,
        system: SYSTEM_PROMPT,
        prompt: `Exercise name: "${body.data.name}"`,
        maxRetries: 0,
        abortSignal: signal,
      }),
    )
    // The prompt asks for the name's prefix equipment first; code makes it so.
    return NextResponse.json({ ...object, equipment: equipmentLedByName(object.normalizedName, object.equipment) })
  } catch (err) {
    reportServerError(err, { url: '/api/exercises/generate' })
    return aiPausedResponse(err) ?? NextResponse.json({ error: 'Generation failed' }, { status: 500 })
  }
}
