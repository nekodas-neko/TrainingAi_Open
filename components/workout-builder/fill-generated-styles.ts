import type { GeneratedProgram } from '@trainingai/shared/types/builder'
import { mostUsedStyleId } from '@/components/config/default-exercise-style'

/**
 * Give any generated exercise with no progression style the one this program already uses (LA-183).
 *
 * The generator resolves a style NAME to an id against the user's own styles
 * (`app/api/generate-program`), and the lookup can miss — a goal with no rule, or a model-proposed
 * accessory name the user has no style for — so the review screen can be handed an exercise with
 * `progressionStyleId` unset. Nothing said so: the row's sets/reps line renders nothing at all for a
 * style it cannot resolve, and the save wrote the gap straight through. What it costs shows up much
 * later, when a path that needs a non-empty style skips the exercise — the deload override
 * prescribed one its ordinary working weight in a deload week (BF-200).
 *
 * Read off the generated program rather than the user's style list, which this screen does not have:
 * every id already in the program was resolved server-side, so the most-used one is valid by
 * construction, and the name beside it is the one the row knows how to display.
 *
 * Returns the program unchanged — the same object — when nothing is missing, so a memo over it stays
 * referentially stable and the screen re-renders no more than it did before.
 */
export function fillGeneratedStyles(program: GeneratedProgram): GeneratedProgram {
  if (program.sessions.every(s => s.exercises.every(e => !!e.progressionStyleId))) return program

  const slots = program.sessions.map(s => ({
    exercises: s.exercises.map(e => ({ styleId: e.progressionStyleId, exerciseRole: e.exerciseRole })),
  }))
  const nameById = new Map<string, string>()
  for (const session of program.sessions) {
    for (const ex of session.exercises) {
      if (ex.progressionStyleId && ex.progressionStyleName) nameById.set(ex.progressionStyleId, ex.progressionStyleName)
    }
  }

  return {
    ...program,
    sessions: program.sessions.map(session => ({
      ...session,
      exercises: session.exercises.map(ex => {
        if (ex.progressionStyleId) return ex
        const styleId = mostUsedStyleId(slots, ex.exerciseRole)
        if (!styleId) return ex
        return {
          ...ex,
          progressionStyleId: styleId,
          progressionStyleName: nameById.get(styleId) ?? ex.progressionStyleName,
        }
      }),
    })),
  }
}
