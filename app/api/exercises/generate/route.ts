import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { generateObject } from 'ai'
import { aiModel, loggedGenerateObject } from '@/lib/ai/instrument'
import { rateLimit } from '@/lib/rate-limit'
import { z } from 'zod'
import { reportServerError } from '@/lib/observability'

const RequestSchema = z.object({
  name: z.string().min(1).max(120),
})

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
- equipment: the equipment matching the name's prefix must be listed first. Only add further entries if the exercise is commonly performed interchangeably with near-identical form on that equipment (e.g. dumbbell/kettlebell goblet squats).`

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (!rateLimit(`exercise-gen:${session.user.id}`, 20, 60_000)) {
    return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 })
  }

  const body = RequestSchema.safeParse(await req.json())
  if (!body.success) return NextResponse.json({ error: 'Invalid body' }, { status: 400 })

  try {
    const { object } = await loggedGenerateObject(
      { section: 'exercises-generate', userId: session.user.id, fingerprint: body.data.name },
      () => generateObject({
        model: aiModel(),
        schema: ExerciseGenSchema,
        system: SYSTEM_PROMPT,
        prompt: `Exercise name: "${body.data.name}"`,
        maxRetries: 0,
      }),
    )
    return NextResponse.json(object)
  } catch (err) {
    reportServerError(err, { url: '/api/exercises/generate' })
    return NextResponse.json({ error: 'Generation failed' }, { status: 500 })
  }
}
