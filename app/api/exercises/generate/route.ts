import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { generateObject } from 'ai'
import { loggedGenerateObject } from '@/lib/ai/instrument'
import { aiPausedResponse } from '@/lib/ai/provider-paused'
import { rateLimit } from '@/lib/rate-limit'
import { z } from 'zod'
import { reportServerError } from '@/lib/observability'
import { readJsonLimited } from '@trainingai/shared/http/request-guards'
import { PROSE_FIELD_GUARDS } from '@/lib/ai/prompt-guards'
import { getRepository } from '@/lib/data'
import { buildExerciseNameResolver } from '@trainingai/shared/workout/exercise-name-resolver'
import { equipmentLedByName } from '@trainingai/shared/workout/equipment'
import { isAdminUser } from '@/lib/admin'
import { ExerciseGenSchema } from '@trainingai/shared/workout/model-output-schemas'

// One exercise name, capped at 120 characters by the schema below.
const MAX_BODY_BYTES = 4 * 1024

const RequestSchema = z.object({
  name: z.string().min(1).max(120),
  /**
   * #3840: skip the library lookup and ask the model, to refresh an existing entry's instructions
   * and muscles. Only the admin exercise editor sends it, and only an admin may: anyone else would
   * spend a model call on every name the library already answers for free.
   */
  refresh: z.literal(true).optional(),
}).strict()

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
    // Fails closed: a refresh from anyone but an active admin is refused, and a failed lookup is a 500.
    if (body.data.refresh && !await isAdminUser(session.user.id)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // #3751: a name the library already holds costs no model call. The resolver is the one the
    // program routes use (exact, normalised, word order; never a subset), so "bench press" finds
    // "Bench Press" and "Incline Bench Press" does not. Merged duplicates are not offered, as in
    // every picker (RV-51). `libraryId` tells the caller this is an existing row, not a draft.
    // An admin's refresh skips it on purpose (#3840).
    const existing = body.data.refresh ? null : buildExerciseNameResolver(
      (await (await getRepository()).listExerciseLibrary()).filter(ex => !ex.mergedInto),
    ).resolve(body.data.name)
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
      (signal, settings) => generateObject({
        ...settings,
        schema: ExerciseGenSchema,
        system: SYSTEM_PROMPT,
        prompt: `Exercise name: "${body.data.name}"`,
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
