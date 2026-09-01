import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'
import { rateLimit } from '@/lib/rate-limit'
import { generateObject } from 'ai'
import { aiModel, loggedGenerateObject } from '@/lib/ai/instrument'
import { z } from 'zod'
import type { GeneratedProgram, GeneratedExercise } from '@trainingai/shared/types/builder'
import { KNOWN_STYLES, GOAL_STYLE_RULES } from '@trainingai/shared/workout/known-styles'
import { buildExerciseNameResolver, resolveAgainstLibrary } from '@trainingai/shared/workout/exercise-name-resolver'
import { activeInjuries, activeInjuredMuscles, formatInjuryContext } from '@trainingai/shared/workout/injury-context'
import { excludeInjuredExercises } from '@trainingai/shared/workout/injury-substitution'
import { todayInTz, DEFAULT_TZ } from '@trainingai/shared/date-utils'
import {
  styleWorkSec, workingBudgetMin,
  TRANSITION_SEC_BARBELL, TRANSITION_SEC_STANDARD, TRANSITION_SEC_BODYWEIGHT,
} from '@trainingai/shared/workout/duration-model'
import { reportServerError } from '@/lib/observability'
import { readJsonLimited } from '@trainingai/shared/http/request-guards'

// Thirteen mostly-scalar fields — but `equipment` and `musclesToFocus` are `z.array(z.string())`
// with a `.min(1)` and **no `.max()`**, so the schema alone bounds neither their count nor their
// length. Until those gain caps, this byte limit is the only thing bounding what reaches the model.
const MAX_BODY_BYTES = 256 * 1024

const RequestSchema = z.object({
  programName: z.string().min(1).max(100),
  equipment: z.array(z.string()).min(1),
  sessionsPerWeek: z.number().int().min(1).max(7),
  timePerSessionMinutes: z.number().int().min(30).max(180).nullable(),
  musclesToFocus: z.array(z.string()).min(1),
  goal: z.enum(['hypertrophy', 'strength+hypertrophy', 'powerbuilding', 'strength']),
  progressionMode: z.enum(['linear', 'phase', 'ai']).default('phase'),
  phaseStructureName: z.string().optional(),
  totalWeeks: z.number().int().min(4).max(52).default(12),
  scheduleType: z.enum(['rotation', 'weekly']).default('rotation'),
  rotationRestAfterN: z.number().int().min(1).max(7).default(3),
  weeklyDays: z.array(z.number().int().min(0).max(6)).default([0, 2, 4]),
  /**
   * BF-67. The id of an existing program to build the new one "similar to". **An id, never a
   * program object** — the structure is read server-side and `user_id`-scoped, because accepting
   * one from the client would be both an ownership hole and a prompt-injection surface, for no
   * benefit the id does not already give.
   */
  referenceProgramId: z.string().uuid().optional(),
}).strict()

/**
 * How much of a referenced program reaches the prompt. Bounded at the schema rather than by hoping:
 * the note above `MAX_BODY_BYTES` already records that `equipment` and `musclesToFocus` are
 * unbounded arrays held only by the byte cap, and a program is a larger structure than either.
 * A real five-session program is ~30 exercise names, so these caps do not bite on anything real.
 */
const REFERENCE_MAX_SESSIONS = 10
const REFERENCE_MAX_EXERCISES_PER_SESSION = 20

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

// Work+rest minutes per exercise for a style's set shape — transition overhead is
// listed separately in the prompt because it depends on the exercise's equipment.
function styleTimeMin(sets: { reps: number; restSec: number }[]): number {
  return Math.round((styleWorkSec(sets) / 60) * 10) / 10
}

// Maps training goal → goal-specific phase set name (created in migration 042).
const GOAL_PHASE_SET_MAP: Record<string, string> = {
  hypertrophy:            'Hypertrophy Progression',
  'strength+hypertrophy': 'S+H Progression',
  powerbuilding:          'Powerbuilding Progression',
  strength:               'Strength Progression',
}

const GeneratedExerciseSchema = z.object({
  name: z.string(),
  exerciseRole: z.enum(['primary', 'secondary', 'accessory']),
  progressionStyleName: z.string(),
  mainMuscles: z.array(z.string()),
  secondaryMuscles: z.array(z.string()),
})

const GeneratedProgramSchema = z.object({
  name: z.string(),
  sessions: z.array(z.object({
    name: z.string(),
    icon: z.string(),
    exercises: z.array(GeneratedExerciseSchema),
  })),
  reasoning: z.string(),
})
export async function POST(req: Request) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const userId = session.user.id

  if (!rateLimit(`generate-program:${userId}`, 20, 60 * 60 * 1000)) {
    return NextResponse.json({ error: 'Rate limit exceeded. Try again in an hour.' }, { status: 429 })
  }

  const read = await readJsonLimited(req, MAX_BODY_BYTES)
  if (!read.ok) {
    return read.reason === 'too_large'
      ? NextResponse.json({ error: 'Request too large' }, { status: 413 })
      : NextResponse.json({ error: 'Invalid input' }, { status: 400 })
  }
  const body = read.body
  const parsed = RequestSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Invalid input', issues: parsed.error.issues }, { status: 400 })

  const inputs = parsed.data
  const repo = await getRepository()

  const [allExercises, userStyles, injuries, referenceProgram] = await Promise.all([
    repo.listExerciseLibrary(),
    repo.listProgressionStyles(userId),
    repo.listInjuries(userId),
    // BF-67. `listPrograms` is already user-scoped, and the id is matched against what it returns
    // rather than fetched directly — so a referenced program the caller does not own is simply
    // absent, with no separate not-found branch to distinguish the two cases from outside.
    inputs.referenceProgramId
      ? repo.listPrograms(userId).then(ps => ps.find(p => p.id === inputs.referenceProgramId) ?? null).catch(() => null)
      : Promise.resolve(null),
  ])

  const equipmentSet = buildEquipmentSet(inputs.equipment)
  const focusSet = new Set(inputs.musclesToFocus.map(m => m.toLowerCase()))

  const eligibleExercises = allExercises.filter(ex => {
    const hasEquipment = ex.equipment.length === 0 || ex.equipment.some(e => equipmentSet.has(e.toLowerCase()))
    const muscleNames = ex.muscles.map(m => m.muscle.toLowerCase())
    const relevant = muscleNames.some(m => focusSet.has(m)) || focusSet.has('full body')
    return hasEquipment && relevant
  })

  if (eligibleExercises.length === 0) {
    return NextResponse.json(
      { error: 'No exercises found for your selected equipment and muscles. Try adding more equipment or broader muscle targets.' },
      { status: 400 },
    )
  }

  // BF-68. The injury exclusion happens HERE, on the candidate list, not in the prompt: an exercise
  // that is not in the list is one the model cannot return, whereas an instruction not to program
  // deadlifts is advice. It also uses the predicate the mid-workout swap sheet substitutes by, so
  // the builder cannot put an exercise into the program that the swap sheet then offers to replace.
  const injuredMuscles = activeInjuredMuscles(injuries)
  const filteredExercises = excludeInjuredExercises(eligibleExercises, injuredMuscles)

  // Everything the equipment and focus allowed touches an injured muscle. Generating anyway would
  // mean programming through the injury, and silently dropping the constraint is worse than saying
  // the two requests cannot both be honoured.
  if (filteredExercises.length === 0) {
    return NextResponse.json(
      {
        // The injuries' own spelling, not the lowercased set the filter runs on: this string is
        // read by a person, and "chest" where the app everywhere else says "Chest" reads as a bug.
        error: `Every exercise for your selected equipment and muscles involves an area you have logged as injured (${activeInjuries(injuries).map(i => i.muscleName).join(', ')}). Broaden the muscle targets, or mark the injury resolved if it has healed.`,
      },
      { status: 400 },
    )
  }

  const exerciseList = filteredExercises.map(ex =>
    `${ex.name}|${ex.muscles.map(m => `${m.muscle}(${m.role})`).join(',')}|${ex.equipment.map(e => EQUIPMENT_LABEL[e.toLowerCase()] ?? e).join(',')}`)
    .join('\n')

  // The AI regularly misattributes muscles (e.g. lists Glutes as main for squats), so its
  // mainMuscles/secondaryMuscles output is never read — the library's assignments are written over
  // it at resolution time below, which is also where the name is repaired to the library's spelling.
  const nameResolver = buildExerciseNameResolver(filteredExercises)

  // Filter style menu to styles the user actually has
  const userStyleNames = new Set(userStyles.map(s => s.name))
  const availableStyles = KNOWN_STYLES.filter(s => userStyleNames.has(s.name))

  const styleMenu = availableStyles
    .map(s => `  - "${s.name}": ${s.description} (~${styleTimeMin(s.sets)} min/exercise + setup overhead)`)
    .join('\n')

  // Compute target exercise count using a weighted average of primary (60%) and accessory (40%) styles.
  // A session isn't all heavy compounds — ~40% of exercises are accessories with shorter sets/rest,
  // so using primary time alone significantly underestimates how many exercises fit in the session.
  let targetExercises: string
  if (!inputs.timePerSessionMinutes) {
    targetExercises = `No time constraint — aim for moderate volume: 5–6 compounds + 2–3 accessories = 7–9 exercises per session.`
  } else {
    const workMin = workingBudgetMin(inputs.timePerSessionMinutes)
    const workTimeSec = workMin * 60
    const goalRules = GOAL_STYLE_RULES[inputs.goal]
    const primaryStyle = KNOWN_STYLES.find(s => s.name === goalRules.primary) ?? KNOWN_STYLES[0]
    const accessoryStyle = KNOWN_STYLES.find(s => s.name === goalRules.accessory) ?? KNOWN_STYLES[0]
    const primaryTimeSec = styleWorkSec(primaryStyle.sets) + TRANSITION_SEC_BARBELL
    const accessoryTimeSec = styleWorkSec(accessoryStyle.sets) + TRANSITION_SEC_STANDARD
    const avgExerciseTimeSec = Math.round(0.6 * primaryTimeSec + 0.4 * accessoryTimeSec)
    const exerciseCount = Math.max(3, Math.floor(workTimeSec / avgExerciseTimeSec))
    const compounds = Math.ceil(exerciseCount * 0.6)
    const accessories = exerciseCount - compounds
    targetExercises = `${inputs.timePerSessionMinutes} min session (working time after warmup + finish-early margins: ${workMin} min) → target ~${exerciseCount} exercises (${compounds} compounds + ${accessories} accessories). Use the style time estimates below to stay within budget.`
  }

  // BF-67. Structure only — session names, exercise names, roles and styles. No loads, no history:
  // what the owner asked for is *"what I did and what I would like similar to"*, and the shape is
  // what carries that. Exercise names go in under the LIBRARY's spelling where the program has
  // drifted, because the resolver added by LA-43 matches exact → normalised → word order and
  // deliberately will NOT match a subset: a stored "Barbell Back Squat" would not reach a library
  // "Back Squat", and the model would be shown a name it cannot legally return.
  const referenceBlock = referenceProgram
    ? `

REFERENCE PROGRAM — the user's existing "${referenceProgram.name}". Build something in the same
spirit: keep exercises they already do where the constraints above still allow it, and change one
only when there is a reason. Do NOT copy it verbatim — the constraints above win.
${referenceProgram.sessions
  .slice(0, REFERENCE_MAX_SESSIONS)
  .map(sess => {
    const names = sess.exercises
      .slice(0, REFERENCE_MAX_EXERCISES_PER_SESSION)
      .map(ex => {
        const canonical = nameResolver.resolve(ex.exerciseName)?.name ?? ex.exerciseName
        const style = userStyles.find(st => st.id === ex.styleId)?.name
        return `${canonical} (${ex.exerciseRole}${style ? `, ${style}` : ''})`
      })
      .join(', ')
    return `- ${sess.name}: ${names}`
  })
  .join('\n')}`
    : ''

  // BF-68. The exclusion above already guarantees no injured-muscle exercise is offerable, so this
  // block exists for the other half of what the owner asked for — the coach saying why, unprompted,
  // rather than silently returning a program with no deadlifts in it. It states the injuries and
  // the rule; it does not ask the model to work out which exercises they rule out.
  const injuryContext = formatInjuryContext(injuries, todayInTz(session.user.timezone ?? DEFAULT_TZ))
  const injuryBlock = injuryContext
    ? `

ACTIVE INJURIES — the exercise list below has ALREADY had everything involving these areas removed,
so nothing you can pick will load them. Say in \`notes\` which area you worked around and what you
chose instead, so the user can see the program accounts for it:
${injuryContext}`
    : ''

  const systemPrompt = `You are an expert strength and conditioning coach designing programs for optimal muscle growth and strength.`

  const volumeTargets =
    inputs.goal === 'hypertrophy'
    ? 'Hypertrophy: 10–20 sets per muscle group per week (optimal: 15–20). Prioritise volume over load.'
    : inputs.goal === 'strength'
    ? 'Strength: 15–25 sets per muscle group per week (optimal: 20–25). Heavy compound movements dominate.'
    : inputs.goal === 'powerbuilding'
    ? 'Powerbuilding: 15–20 sets per muscle group per week at high intensity. Heavy compounds for strength stimulus; some isolation for hypertrophy.'
    : 'Strength + Hypertrophy: 15–20 sets per muscle group per week, split between compound (heavy) and isolation (moderate rep) work'

  const scheduleDescription = inputs.scheduleType === 'rotation'
    ? `Rolling rotation — rest after every ${inputs.rotationRestAfterN} sessions (sessions run in cycle order, then 1 rest day, repeat regardless of calendar week). Sessions ${inputs.rotationRestAfterN} and ${inputs.rotationRestAfterN + 1} in the cycle run on CONSECUTIVE training days.`
    : `Fixed weekly — training days: ${inputs.weeklyDays.map(d => ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'][d]).join(', ')}.`

  const progressionContext = inputs.progressionMode === 'linear'
    ? `PROGRESSION MODE: LINEAR. Do NOT use phases. Generate a flat program where the user adds weight each session. Set phaseStructureName to "Linear Progression" in your response. Set phaseSetId to empty string "". Total program length: ${inputs.totalWeeks} weeks.`
    : inputs.progressionMode === 'ai'
    ? `PROGRESSION MODE: AI DYNAMIC. Do NOT use phases. Generate an optimal exercise structure — load, volume, and periodization will be dynamically adjusted by AI each session. Set phaseStructureName to "AI Dynamic" in your response. Set phaseSetId to empty string "". Total program length: ${inputs.totalWeeks} weeks.`
    : `PROGRESSION MODE: PHASE-BASED (${inputs.phaseStructureName}). Use Accumulation → Intensification → Peak phase structure. Total program length: ${inputs.totalWeeks} weeks — distribute this across phases as you see fit, but must keep the same phase order.`

  const userPrompt = `Design a workout program with these constraints:
- Program name: "${inputs.programName}"
- Available equipment: ${inputs.equipment.map(e => EQUIPMENT_LABEL[e] ?? e).join(', ')}
- Training days per week: ${inputs.sessionsPerWeek}
- Session volume target: ${targetExercises}
- Muscles to focus on: ${inputs.musclesToFocus.join(', ')}
- Training goal: ${inputs.goal}
- ${progressionContext}
- Schedule: ${scheduleDescription}

VOLUME GUIDELINES (critical for optimal results):
${volumeTargets}

PROGRESSION STYLES — assign one to each exercise:
${styleMenu}

PER-EXERCISE SETUP OVERHEAD — add on top of the style time when fitting the budget:
- barbell exercises: ~${Math.round(TRANSITION_SEC_BARBELL / 60)} min (plate loading, warm-up ramp)
- machine / dumbbell / cable / kettlebell: ~${Math.round(TRANSITION_SEC_STANDARD / 60)} min
- bodyweight: ~${Math.round(TRANSITION_SEC_BODYWEIGHT / 60)} min

Style assignment (informational — the server enforces styles by role for this goal):
- primary compounds get "${GOAL_STYLE_RULES[inputs.goal].primary}", secondary compounds "${GOAL_STYLE_RULES[inputs.goal].secondary}", accessories "${GOAL_STYLE_RULES[inputs.goal].accessory}".
- Set progressionStyleName accordingly and use those styles' time estimates when fitting the session time budget.

RECOMMENDED SPLITS BY FREQUENCY:
- 1 day  → Full Body
- 2 days → Full Body / Full Body  (hit every muscle twice)
- 3 days → Push / Pull / Legs
- 4 days → Upper / Lower / Upper / Lower  (or Push / Pull / Legs / Upper)
- 5 days → Push / Pull / Legs / Upper / Lower  (each major muscle hit twice/week)
- 6 days → Push / Pull / Legs / Push / Pull / Legs
- 7 days → PPL × 2 + 1 Full Body (or add dedicated arms/shoulders day)

Each major muscle should appear in 2 different sessions per week to achieve optimal weekly volume.
Each minor muscle (biceps, triceps, calves, core) gets sufficient volume from compound carry + 1 direct session.

Rules:
1. Use the recommended split for the given frequency above.
2. Use ONLY exercises from the list below. Match exercise names exactly.
3. Assign each exercise a role: "primary" (main compound), "secondary" (secondary compound), or "accessory" (isolation/single-joint).
4. Assign each exercise a progressionStyleName from the available styles listed above. Use the exact style name string.
5. IMPORTANT: The sum of (~style time + setup overhead) × exercise count per session must fit within the working time budget.
6. Match each session's exercise count to the "Session volume target" above (the single count authority) — keep the compound:isolation split at roughly 60:40 of that target. Do NOT cap sessions at 3–5 exercises.
7. MUSCLE PRIORITY — build exercises in this order:
   a. FIRST: ensure LARGE muscles (chest, back, quads, hamstrings, glutes) each reach ${inputs.goal === 'hypertrophy' ? '15–20' : inputs.goal === 'strength' ? '20–25' : '15–20'} sets/week across sessions (${inputs.goal === 'powerbuilding' ? 'powerbuilding: heavy compound bias' : ''}). Distribute them across 2 sessions/week minimum.
   b. THEN: add direct work for SMALL muscles (shoulders, biceps, triceps, calves, core) only AFTER large muscles are covered. Small muscles get 6–10 direct sets/week — they receive compound carry from large-muscle exercises.
   c. If the time budget runs out, cut small-muscle isolation exercises first. Never cut large-muscle compounds.
8. Large muscles (chest, back, quads, hamstrings, glutes): aim for the UPPER end of their set range. They are the priority.
9. Small muscles (biceps, triceps, calves, core): 6–10 direct sets/week is sufficient — compound carry counts toward this.
10. SESSION NAMES — use SHORT standard names only. Do NOT include muscle lists or parenthetical annotations in any form.
    - 3-day: "Push", "Pull", "Legs"
    - 4-day Upper/Lower: "Upper Push", "Upper Pull", "Lower Squat", "Lower Hinge"
    - 4-day PPL+Upper: "Push", "Pull", "Legs", "Upper"
    - 5-day: "Push", "Pull", "Legs", "Upper", "Lower"
    - 6-day: "Push A", "Push B", "Pull A", "Pull B", "Legs A", "Legs B"
    - 1-day or 2-day: "Full Body", "Full Body A", "Full Body B"
    - NEVER generate names like "Push Day (Chest/Shoulders/Triceps)" or "Upper Body Push" — 1–2 words maximum.
11. Pick a session icon emoji matching the session focus.
12. MUSCLE RECOVERY (critical for rolling rotation): Sessions that run on consecutive training days must NOT share primary muscle groups. The session ORDER in your output determines the training day sequence — adjacent sessions in the list will be trained back-to-back. Ensure each consecutive pair of sessions targets different primary muscles (e.g. Push then Pull is fine; Push then Upper Push is not).
13. Before finalising: tally sets per large muscle across all sessions. Confirm each large muscle hits its target. Confirm time budget is met. Confirm no consecutive sessions share primary muscles.

Available exercises (name|muscles|equipment):
${exerciseList}${injuryBlock}${referenceBlock}`

  try {
    const { object: raw } = await loggedGenerateObject(
      { section: 'generate-program', userId, fingerprint: userPrompt },
      () => generateObject({
        model: aiModel(),
        schema: GeneratedProgramSchema,
        system: systemPrompt,
        prompt: userPrompt,
        maxRetries: 0,
      }),
    )

    // Rule 2 of the prompt asks for exact names from the list; the model paraphrases anyway. An
    // exact-match filter used to DROP every paraphrase silently, so a session came back short of
    // the volume target the time budget was computed from, with nothing saying why. Resolving
    // first means "Barbell Bench Press" is recognised as the library's "Bench Press" and the
    // exercise is kept — under the LIBRARY's name, because `personal_records` and
    // `exercise_estimates` are unique on `(user_id, exercise_name)`, so a paraphrase that survived
    // would start that lift's history from zero.
    const unresolved: string[] = []
    for (const sess of raw.sessions) {
      const outcome = resolveAgainstLibrary(sess.exercises, nameResolver)
      sess.exercises = outcome.resolved
      unresolved.push(...outcome.unresolved)
    }

    if (unresolved.length > 0) {
      // Dropping is still the right call for a name the library genuinely does not hold — one lost
      // accessory should not cost a whole generation — but it must not be silent, or a model that
      // starts inventing names degrades the programs with no trace anywhere.
      reportServerError(
        new Error(`generate-program dropped ${unresolved.length} unresolvable exercise name(s): ${unresolved.slice(0, 10).join(', ')}`),
        { userId, url: '/api/generate-program' },
      )
    }

    const emptySessions = raw.sessions.filter(s => s.exercises.length === 0).map(s => s.name)
    if (emptySessions.length > 0 || raw.sessions.length === 0) {
      // A session with no exercises is not a program the user can start — it is a broken artefact
      // they have to notice and repair by hand. Fail loudly instead of returning it.
      return NextResponse.json(
        { error: `The generated program had ${emptySessions.length > 0 ? `no usable exercises for: ${emptySessions.join(', ')}` : 'no sessions'}. Please try again.` },
        { status: 502 },
      )
    }

    // Map progressionStyleName → progressionStyleId using the user's actual styles
    const styleByName = new Map(userStyles.map(s => [s.name, s.id]))
    const styleById = new Map(userStyles.map(s => [s.id, s.name]))

    type PhaseSet = Awaited<ReturnType<typeof repo.listPhaseSets>>[number]
    let phaseSet: PhaseSet | undefined
    if (inputs.progressionMode === 'phase') {
      const phaseSets = await repo.listPhaseSets(userId)
      const goalPhaseSetName = GOAL_PHASE_SET_MAP[inputs.goal]
      phaseSet =
        phaseSets.find(ps => ps.name === goalPhaseSetName) ??
        (inputs.phaseStructureName ? phaseSets.find(ps => ps.name === inputs.phaseStructureName) : undefined) ??
        phaseSets.find(ps => ps.isDefault) ??
        phaseSets[0]
      if (!phaseSet) {
        return NextResponse.json({ error: 'No phase sets found. Please set up a phase set in your account settings.' }, { status: 400 })
      }
    }

    const SESSION_EMOJI: Record<string, string> = {
      push: '🫸', pull: '🫷', legs: '🦵', upper: '💪', lower: '🦵',
      'full body': '🏋️', cardio: '🏃', core: '🔥', arms: '💪',
      back: '🔙', chest: '🫁', shoulders: '🙆', glutes: '🍑',
    }

    const programJson: GeneratedProgram = {
      name: raw.name,
      sessions: raw.sessions.map(s => {
        const hasEmoji = /\p{Emoji_Presentation}|\p{Extended_Pictographic}/u.test(s.icon ?? '')
        const icon = hasEmoji
          ? s.icon
          : (SESSION_EMOJI[s.name.toLowerCase()] ?? SESSION_EMOJI[s.name.toLowerCase().split(' ')[0]] ?? '🏋️')
        return {
          name: s.name,
          icon,
          exercises: s.exercises.map(ex => {
            const role = ex.exerciseRole as GeneratedExercise['exerciseRole']
            const aiStyleName = ex.progressionStyleName
            const goalRules = GOAL_STYLE_RULES[inputs.goal]
            let styleName = aiStyleName
            if (goalRules) {
              const enforced = goalRules[role as keyof typeof goalRules] ?? goalRules.accessory
              if (role === 'primary' || role === 'secondary') {
                // Always enforce — never fall back to AI choice for primary/secondary
                styleName = enforced
              } else {
                // For accessories accept AI's choice if valid, otherwise use enforced default
                styleName = styleByName.has(aiStyleName) ? aiStyleName : enforced
              }
            }
            const styleId = styleByName.get(styleName)
            return {
              name: ex.name,
              exerciseRole: role,
              progressionStyleName: styleName || undefined,
              progressionStyleId: styleId,
              mainMuscles: ex.mainMuscles,
              secondaryMuscles: ex.secondaryMuscles,
            }
          }),
        }
      }),
      reasoning: raw.reasoning,
      phaseStructureName: inputs.progressionMode === 'linear' ? 'Linear Progression' : inputs.progressionMode === 'ai' ? 'AI Dynamic' : phaseSet!.name,
      phaseSetId: inputs.progressionMode === 'phase' ? phaseSet!.id : '',
      phases: inputs.progressionMode === 'phase'
        ? phaseSet!.phases
            .filter(p => p.phaseType !== 'accessory')
            .sort((a, b) => a.position - b.position)
            .map(p => ({
              name: p.name,
              durationCycles: p.durationCycles,
              phaseType: p.phaseType,
              primaryStyleName: p.primaryStyleName ?? (p.primaryStyleId ? styleById.get(p.primaryStyleId) : undefined),
            }))
        : [],
    }

    return NextResponse.json({ program: programJson })
  } catch (err) {
    reportServerError(err, { userId, url: '/api/generate-program' })
    console.error('[generate-program] Gemini error:', err)
    return NextResponse.json({ error: 'Failed to generate program. Please try again.' }, { status: 500 })
  }
}
