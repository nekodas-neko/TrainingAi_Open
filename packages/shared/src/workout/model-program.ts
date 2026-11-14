import { z } from 'zod'
import type { GeneratedExercise, GeneratedSession } from '../types/builder'
import { capPrimariesPerSession } from './exercise-role'
import {
  resolveAgainstLibrary,
  type ExerciseNameResolver,
  type MuscleAssignedExercise,
} from './exercise-name-resolver'
import { GOAL_STYLE_RULES } from './known-styles'

/**
 * What the MODEL is asked to return for one exercise, by `/api/generate-program` and
 * `/api/builder-chat` alike (#3750). No muscles: `cleanModelProgram` writes the library's over
 * whatever the model would say, and they are a field it is known to get wrong (RV-76).
 *
 * Not to be confused with the request-side `GeneratedExerciseSchema` in
 * `validation/generated-program.ts`, which is `.strict()`, validates the program the builder client
 * posts back, and does carry muscles.
 */
export const ModelExerciseSchema = z.object({
  name: z.string(),
  exerciseRole: z.enum(['primary', 'secondary', 'accessory']),
  progressionStyleName: z.string(),
})

export const ModelSessionSchema = z.object({
  name: z.string(),
  icon: z.string(),
  exercises: z.array(ModelExerciseSchema),
})

export type ModelSession = z.infer<typeof ModelSessionSchema>

/** Used when the model's icon is not an emoji: by the session's name, then its first word. */
const SESSION_EMOJI: Record<string, string> = {
  push: '🫸', pull: '🫷', legs: '🦵', upper: '💪', lower: '🦵',
  'full body': '🏋️', cardio: '🏃', core: '🔥', arms: '💪',
  back: '🔙', chest: '🫁', shoulders: '🙆', glutes: '🍑',
}
const DEFAULT_SESSION_EMOJI = '🏋️'

function knownIcon(sessionName: string, icon: string): string {
  if (/\p{Emoji_Presentation}|\p{Extended_Pictographic}/u.test(icon ?? '')) return icon
  const key = sessionName.toLowerCase()
  return SESSION_EMOJI[key] ?? SESSION_EMOJI[key.split(' ')[0]] ?? DEFAULT_SESSION_EMOJI
}

export interface CleanModelProgramOptions<L extends MuscleAssignedExercise> {
  /** The library the model was allowed to pick from. Each route builds its own. */
  resolver: ExerciseNameResolver<L>
  /** The training goal. Without one (the chat may not be told it) the model's styles are kept. */
  goal?: string | null
  /** The user's progression styles, name to id. */
  styleIdByName: ReadonlyMap<string, string>
  /** Replace an icon that is not an emoji with a known one. */
  fallbackIcon?: boolean
}

/**
 * Turn the sessions a model returned into ones the app can store. The one implementation behind
 * both program routes: they used to do this separately, and the chat kept an exercise only on an
 * exact name match, so it removed a paraphrase the generator would have kept (#3750).
 *
 * In order, per session:
 *  1. each name is resolved against the library (`resolveAgainstLibrary`: exact, normalised, word
 *     order) and takes the library's spelling and muscles; a name it does not hold is dropped and
 *     returned in `dropped`;
 *  2. primaries are capped (`capPrimariesPerSession`), after the drop so a removed name cannot
 *     spend the session's one primary, and before the style, which is chosen from the role;
 *  3. with a goal, the style comes from `GOAL_STYLE_RULES` by role: always for a primary or a
 *     secondary, and for an accessory only when the model's choice is not one of the user's styles.
 *
 * It does not decide what a drop or an emptied session is worth; each route does.
 */
export function cleanModelProgram<L extends MuscleAssignedExercise>(
  sessions: readonly ModelSession[],
  { resolver, goal, styleIdByName, fallbackIcon = false }: CleanModelProgramOptions<L>,
): { sessions: GeneratedSession[]; dropped: string[] } {
  const goalRules = goal ? GOAL_STYLE_RULES[goal] : undefined
  const dropped: string[] = []

  const cleaned = sessions.map((sess): GeneratedSession => {
    const { resolved, unresolved } = resolveAgainstLibrary(sess.exercises, resolver)
    dropped.push(...unresolved)

    const exercises = capPrimariesPerSession(resolved).map((ex): GeneratedExercise => {
      const role = ex.exerciseRole
      let styleName = ex.progressionStyleName
      if (goalRules) {
        const enforced = goalRules[role] ?? goalRules.accessory
        if (role === 'primary' || role === 'secondary' || !styleIdByName.has(styleName)) {
          styleName = enforced
        }
      }
      return {
        name: ex.name,
        exerciseRole: role,
        progressionStyleName: styleName || undefined,
        progressionStyleId: styleIdByName.get(styleName),
        mainMuscles: ex.mainMuscles,
        secondaryMuscles: ex.secondaryMuscles,
      }
    })

    return {
      name: sess.name,
      icon: fallbackIcon ? knownIcon(sess.name, sess.icon) : sess.icon,
      exercises,
    }
  })

  return { sessions: cleaned, dropped }
}
