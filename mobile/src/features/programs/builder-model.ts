import { z } from 'zod';
import { GeneratedProgramSchema } from '@trainingai/shared/validation/generated-program';
import { mostUsedStyleId } from '@trainingai/shared/workout/default-style';
import type { ProgramDraft } from './editor-model';
import type { LibraryExercise, SavedStyle } from '../workouts/data/models';

export const BuilderInputSchema = z.object({
  programName: z.string(),
  equipment: z.array(z.string()),
  sessionsPerWeek: z.number().int().min(1).max(7),
  timePerSessionMinutes: z.number().int().min(30).max(180).nullable(),
  musclesToFocus: z.array(z.string()),
  goal: z.enum(['hypertrophy', 'strength+hypertrophy', 'powerbuilding', 'strength']),
  progressionMode: z.enum(['linear', 'phase', 'ai']),
  phaseStructureName: z.string(),
  totalWeeks: z.number().int().min(4).max(52),
  scheduleType: z.enum(['rotation', 'weekly']),
  rotationRestAfterN: z.number().int().min(1).max(7),
  weeklyDays: z.array(z.number().int().min(0).max(6)),
  referenceProgramId: z.string().optional(),
});
export type BuilderInputs = z.infer<typeof BuilderInputSchema>;
export type GeneratedProgram = z.infer<typeof GeneratedProgramSchema>;
export function builderSteps(mode: BuilderInputs['progressionMode']) {
  return mode === 'ai'
    ? [1, 2, 3, 4, 5, 6, 7]
    : mode === 'linear'
      ? [1, 2, 3, 4, 5, 6, 7, 9, 10]
      : [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
}
export function reviewedProgram(
  original: GeneratedProgram,
  draft: ProgramDraft,
  library: LibraryExercise[],
  styles: SavedStyle[],
): GeneratedProgram {
  return GeneratedProgramSchema.parse({
    ...original,
    name: draft.name,
    sessions: draft.sessions.map((session) => ({
      name: session.name,
      icon: session.icon ?? '💪',
      exercises: session.exercises.map((exercise) => {
        const definition = library.find((item) => item.name === exercise.exerciseName);
        const previous = original.sessions
          .flatMap((item) => item.exercises)
          .find((item) => item.name === exercise.exerciseName);
        return {
          name: exercise.exerciseName,
          exerciseRole: exercise.exerciseRole ?? 'accessory',
          mainMuscles:
            definition?.muscles.filter((item) => item.role === 'main').map((item) => item.muscle) ??
            previous?.mainMuscles ??
            [],
          secondaryMuscles:
            definition?.muscles
              .filter((item) => item.role === 'secondary')
              .map((item) => item.muscle) ??
            previous?.secondaryMuscles ??
            [],
          progressionStyleId: exercise.styleId ?? undefined,
          progressionStyleName: styles.find((style) => style.id === exercise.styleId)?.name,
          clientId: exercise.id,
        };
      }),
    })),
  });
}
export function generatedDraft(
  program: GeneratedProgram,
  inputs: BuilderInputs,
  uuid: () => string,
): ProgramDraft {
  const slots = program.sessions.map((session) => ({
    exercises: session.exercises.map((exercise) => ({
      styleId: exercise.progressionStyleId,
      exerciseRole: exercise.exerciseRole,
    })),
  }));
  const sessions = program.sessions.map((session, index) => ({
    id: uuid(),
    name: session.name,
    icon: session.icon,
    position: index,
    timeBudgetMinutes: inputs.timePerSessionMinutes ?? 0,
    exercises: session.exercises.map((exercise, index) => ({
      id: uuid(),
      exerciseName: exercise.name,
      exerciseRole: exercise.exerciseRole,
      styleId: exercise.progressionStyleId ?? mostUsedStyleId(slots, exercise.exerciseRole),
      muscleGroups: [...exercise.mainMuscles, ...exercise.secondaryMuscles],
      position: index,
      supersetGroup: null,
    })),
  }));
  return {
    id: uuid(),
    name: program.name,
    isActive: true,
    sessions,
    phaseMode:
      inputs.progressionMode === 'linear'
        ? 'manual'
        : inputs.progressionMode === 'ai'
          ? 'ai_dynamic'
          : 'automatic',
    phaseSetId: inputs.progressionMode === 'phase' ? program.phaseSetId || null : null,
    sessionsPerCycle: sessions.length,
    totalWeeks: inputs.totalWeeks,
    trainingGoal: inputs.goal,
    autoApplyPrescriptions: false,
    schedule:
      inputs.progressionMode === 'ai'
        ? null
        : inputs.scheduleType === 'rotation'
          ? { type: 'rotation', restAfterN: inputs.rotationRestAfterN }
          : {
              type: 'weekly',
              days: inputs.weeklyDays.map((dayOfWeek, index) => ({
                dayOfWeek,
                sessionId: sessions[index % sessions.length].id,
              })),
            },
  };
}
