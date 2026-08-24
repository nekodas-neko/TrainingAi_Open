import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { rateLimit } from '@/lib/rate-limit'
import { getRepository } from '@/lib/data'
import { generateObject } from 'ai'
import { aiModel, loggedGenerateObject } from '@/lib/ai/instrument'
import { z } from 'zod'
import { GeneratedProgramSchema } from '@trainingai/shared/validation/generated-program'
import type { GeneratedProgram, ChatMessage } from '@trainingai/shared/types/builder'
import { KNOWN_STYLES, GOAL_STYLE_RULES } from '@trainingai/shared/workout/known-styles'
import { styleWorkSec, workingBudgetMin, TRANSITION_SEC_BARBELL, TRANSITION_SEC_STANDARD } from '@trainingai/shared/workout/duration-model'
import { reportServerError } from '@/lib/observability'
import { readJsonLimited } from '@trainingai/shared/http/request-guards'

// Fully bounded by its own schema, unlike the coach routes: 20 history messages x 2,000 chars plus a
// 1,000-char message is under 50 KB. 256 KB is generous past that.
const MAX_BODY_BYTES = 256 * 1024

const ChatMessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  // F6: cap history content (the live `message` is already capped at 1000, ai-chat
  // caps history at 2000/turn) — an uncapped string is serialized straight into the
  // prompt, so a buggy/replayed client could ship a megabyte prompt.
  content: z.string().max(2000),
}).strict()

const RequestSchema = z.object({
  message: z.string().min(1).max(1000),
  program: GeneratedProgramSchema,
  chatHistory: z.array(ChatMessageSchema).max(20),
  equipment: z.array(z.string()),
  goal: z.enum(['hypertrophy', 'strength+hypertrophy', 'powerbuilding', 'strength']).optional(),
  timePerSessionMinutes: z.number().int().min(20).max(180).nullable().optional(),
}).strict()

const BuilderExerciseSchema = z.object({
  name: z.string(),
  exerciseRole: z.enum(['primary', 'secondary', 'accessory']),
  progressionStyleName: z.string(),
  mainMuscles: z.array(z.string()),
  secondaryMuscles: z.array(z.string()),
})

const BuilderChatObjectSchema = z.object({
  response: z.string(),
  program: z.object({
    name: z.string(),
    sessions: z.array(z.object({
      name: z.string(),
      icon: z.string(),
      exercises: z.array(BuilderExerciseSchema),
    })),
  }),
})

const EQUIPMENT_LABEL: Record<string, string> = {
  barbell: 'Barbell', dumbbell: 'Dumbbells', cable: 'Cables',
  kettlebell: 'Kettlebells', machine: 'Machines', bodyweight: 'Bodyweight',
}

function buildEquipmentSet(selected: string[]): Set<string> {
  const set = new Set<string>(['bodyweight'])
  if (selected.includes('full_gym')) {
    ;['barbell', 'dumbbell', 'cable', 'kettlebell', 'machine', 'bodyweight'].forEach(e => set.add(e))
  } else {
    selected.forEach(e => set.add(e))
  }
  return set
}

export async function POST(req: Request) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const userId = session.user.id

  if (!rateLimit(`builder-chat:${userId}`, 20, 60 * 60 * 1000)) {
    return NextResponse.json({ error: 'Rate limit exceeded. Try again in an hour.' }, { status: 429 })
  }

  const read = await readJsonLimited(req, MAX_BODY_BYTES)
  if (!read.ok) {
    return read.reason === 'too_large'
      ? NextResponse.json({ error: 'Request too large' }, { status: 413 })
      : NextResponse.json({ error: 'Invalid input' }, { status: 400 })
  }
  const parsed = RequestSchema.safeParse(read.body)
  if (!parsed.success) return NextResponse.json({ error: 'Invalid input' }, { status: 400 })

  const { message, program, chatHistory, equipment, goal, timePerSessionMinutes } = parsed.data
  const repo = await getRepository()

  const [allExercises, userStyles] = await Promise.all([
    repo.listExerciseLibrary(),
    repo.listProgressionStyles(userId),
  ])
  const equipmentSet = buildEquipmentSet(equipment)
  const availableExercises = allExercises
    .filter(ex => ex.equipment.length === 0 || ex.equipment.some(e => equipmentSet.has(e.toLowerCase())))
    .map(ex =>
      `${ex.name}|${ex.muscles.map(m => `${m.muscle}(${m.role})`).join(',')}|${ex.equipment.map(e => EQUIPMENT_LABEL[e.toLowerCase()] ?? e).join(',')}`)
    .join('\n')

  const styleMenu = userStyles.map(s => `  - "${s.name}"`).join('\n')

  const historyText = chatHistory
    .map((m: ChatMessage) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
    .join('\n')

  const goalLabel = goal
    ? { hypertrophy: 'Hypertrophy', 'strength+hypertrophy': 'Strength + Hypertrophy', powerbuilding: 'Powerbuilding', strength: 'Strength' }[goal]
    : 'unknown'
  const goalStyleNote = goal && GOAL_STYLE_RULES[goal]
    ? `The user's goal is "${goalLabel}". Styles are assigned server-side by role (primary "${GOAL_STYLE_RULES[goal].primary}", secondary "${GOAL_STYLE_RULES[goal].secondary}", accessory "${GOAL_STYLE_RULES[goal].accessory}") — set progressionStyleName to those names and never invent others.`
    : 'Keep all progressionStyleName values exactly as they are in the current program.'

  // Compute minimum exercise count from the time budget so the AI doesn't strip sessions.
  // Same model as generate-program: weighted 60% primary (barbell worst case) / 40% accessory.
  let exerciseCountNote = ''
  if (timePerSessionMinutes) {
    const workTimeSec = workingBudgetMin(timePerSessionMinutes) * 60
    const rules = GOAL_STYLE_RULES[goal ?? ''] ?? GOAL_STYLE_RULES.hypertrophy
    const primaryStyle = KNOWN_STYLES.find(s => s.name === rules.primary) ?? KNOWN_STYLES[0]
    const accessoryStyle = KNOWN_STYLES.find(s => s.name === rules.accessory) ?? KNOWN_STYLES[0]
    const primarySec = styleWorkSec(primaryStyle.sets) + TRANSITION_SEC_BARBELL
    const accessorySec = styleWorkSec(accessoryStyle.sets) + TRANSITION_SEC_STANDARD
    const avgSecPerExercise = Math.round(0.6 * primarySec + 0.4 * accessorySec)
    const minExercises = Math.max(3, Math.floor(workTimeSec / avgSecPerExercise))
    exerciseCountNote = `\nSESSION TIME BUDGET: ${timePerSessionMinutes} minutes → minimum ${minExercises} exercises per session. NEVER reduce any session below ${minExercises} exercises when recalculating. Use ${Math.ceil(minExercises * 0.6)} compounds + ${minExercises - Math.ceil(minExercises * 0.6)} accessories as the baseline.`
  }

  const systemPrompt = `You are a fitness coach helping a user refine their workout program with science-backed volume targets. The user may ask to swap exercises, add/remove exercises, change sessions, or adjust volume.

CRITICAL — PROGRESSION STYLES:
${goalStyleNote}
NEVER change progressionStyleName values to a different style family unless the user explicitly asks to change the training goal, intensity, or style. If the user asks to "recalculate", "adjust volume", or "add more exercises", keep the existing styles intact.
${exerciseCountNote}
IMPORTANT VOLUME CONSTRAINTS:
- Hypertrophy: Each muscle should get 10–20 sets per week (optimal: 15–20)
- Strength: Each muscle should get 15–25 sets per week (optimal: 20–25)
- Powerbuilding / Strength+Hypertrophy: 15–20 sets per muscle at high intensity

When making changes, verify the program still distributes volume appropriately across the week. If a user asks to remove exercises, warn them if muscle volume will drop below 10 sets/week for that muscle.`

  const userPrompt = `Current program (${program.sessions.length} sessions/week):
${JSON.stringify(program)}

Available exercises (name|muscles|equipment), filtered by user's equipment:
${availableExercises}

WEEKLY VOLUME CALCULATION EXAMPLE:
If "Chest" appears in: Session 1 (3 exercises, 12 sets) + Session 4 (1 exercise, 3 sets) = 15 sets/week for Chest
Make sure each muscle group hit in this program reaches 10+ sets/week minimum (15–20 optimal for most goals).

Available progression styles (use exact names):
${styleMenu}

Previous conversation:
${historyText || '(none)'}

User message: ${message}

When responding, mention if a change improves or worsens weekly volume balance. Each exercise in the returned program must include progressionStyleName (exact name from the list) and exerciseRole.`

  try {
    const { object: raw } = await loggedGenerateObject(
      { section: 'builder-chat', userId, fingerprint: message },
      () => generateObject({
        model: aiModel(),
        schema: BuilderChatObjectSchema,
        system: systemPrompt,
        prompt: userPrompt,
        maxRetries: 0,
      }),
    )

    const styleByName = new Map(userStyles.map(s => [s.name, s.id]))

    // Authoritative muscle lookup — override whatever the AI returns.
    const exerciseMuscleLookup = new Map(
      allExercises.map(ex => [ex.name, {
        mainMuscles: ex.muscles.filter((m: { muscle: string; role: string }) => m.role === 'main').map((m: { muscle: string; role: string }) => m.muscle),
        secondaryMuscles: ex.muscles.filter((m: { muscle: string; role: string }) => m.role === 'secondary').map((m: { muscle: string; role: string }) => m.muscle),
      }])
    )

    const goalRules = goal ? GOAL_STYLE_RULES[goal] : null

    // F5: drop model-invented exercises not in the library (sibling generate-program
    // already filters). A hallucinated name saves with AI-supplied/empty muscle
    // assignments, silently under-counting that muscle in recovery/volume/heatmaps.
    let droppedUnknown = 0
    const updatedProgram: GeneratedProgram = {
      ...program,
      ...raw.program,
      sessions: raw.program.sessions.map((s: GeneratedProgram['sessions'][number]) => ({
        ...s,
        exercises: s.exercises
          .filter((ex: GeneratedProgram['sessions'][number]['exercises'][number]) => {
            const known = exerciseMuscleLookup.has(ex.name)
            if (!known) droppedUnknown++
            return known
          })
          .map((ex: GeneratedProgram['sessions'][number]['exercises'][number]) => {
          // Re-enforce progression styles so the AI can't switch goal families.
          let styleName = ex.progressionStyleName as string | undefined
          if (goalRules) {
            const role = ex.exerciseRole as string
            const enforced = goalRules[role as keyof typeof goalRules] ?? goalRules.accessory
            if (role === 'primary' || role === 'secondary') {
              styleName = enforced
            } else if (!styleByName.has(styleName ?? '')) {
              styleName = enforced
            }
          }
          const libraryMuscles = exerciseMuscleLookup.get(ex.name)
          return {
            ...ex,
            progressionStyleName: styleName,
            progressionStyleId: styleName ? styleByName.get(styleName) : ex.progressionStyleId,
            mainMuscles: libraryMuscles?.mainMuscles ?? ex.mainMuscles ?? [],
            secondaryMuscles: libraryMuscles?.secondaryMuscles ?? ex.secondaryMuscles ?? [],
          }
        }),
      })),
    }

    const response = droppedUnknown > 0
      ? `${raw.response}\n\n(Removed ${droppedUnknown} exercise${droppedUnknown > 1 ? 's' : ''} not in the exercise library.)`
      : raw.response

    return NextResponse.json({
      response,
      program: updatedProgram,
    })
  } catch (err) {
    reportServerError(err, { userId, url: '/api/builder-chat' })
    console.error('[builder-chat] Gemini error:', err)
    return NextResponse.json({ error: 'Failed to process request. Please try again.' }, { status: 500 })
  }
}
