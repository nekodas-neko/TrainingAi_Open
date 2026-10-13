import { z } from 'zod';
import { ProgramWriteSchema } from '@trainingai/shared/validation/program-write';
import { recommendAddedExerciseRole } from '@trainingai/shared/workout/exercise-role';
import type { LibraryExercise, SavedProgram } from '../workouts/data/models';

const session = ProgramWriteSchema.shape.sessions.unwrap().element;
const exercise = session.shape.exercises.unwrap().element;
export const ProgramDraftSchema = ProgramWriteSchema.extend({
  name: z.string(),
  sessions: z.array(
    session.extend({
      name: z.string(),
      exercises: z.array(exercise.extend({ exerciseName: z.string() })),
    }),
  ),
});
export type ProgramDraft = z.infer<typeof ProgramDraftSchema>;
export function programDraft(program?: SavedProgram): ProgramDraft {
  return {
    ...program,
    name: program?.name ?? '',
    phaseMode: program?.phaseMode ?? 'manual',
    trainingGoal: program?.trainingGoal ?? 'strength',
    autoApplyPrescriptions: program?.autoApplyPrescriptions ?? false,
    isActive: program?.isActive ?? false,
    sessions: (program?.sessions ?? []).map((session) => ({
      ...session,
      exercises: session.exercises ?? [],
    })),
    schedule: program?.schedule ?? null,
  };
}
export function selectExercise(
  draft: ProgramDraft,
  sessionIndex: number,
  exerciseIndex: number,
  library: LibraryExercise,
) {
  const session = draft.sessions[sessionIndex];
  const current = session.exercises[exerciseIndex];
  const role =
    current.exerciseRole ??
    recommendAddedExerciseRole(
      { muscleCount: library.muscles.length, equipment: library.equipment },
      session.exercises
        .filter((_, index) => index !== exerciseIndex)
        .flatMap((exercise) => (exercise.exerciseRole ? [exercise.exerciseRole] : [])),
      session.timeBudgetMinutes ?? 60,
    );
  return {
    ...draft,
    sessions: draft.sessions.map((session, index) =>
      index !== sessionIndex
        ? session
        : {
            ...session,
            exercises: session.exercises.map((exercise, index) =>
              index !== exerciseIndex
                ? exercise
                : {
                    ...exercise,
                    exerciseName: library.name,
                    muscleGroups: library.muscles.map((muscle) => muscle.muscle),
                    exerciseRole: role,
                  },
            ),
          },
    ),
  };
}
export function moveItem<T>(items: T[], index: number, direction: number) {
  const next = items.slice();
  const target = index + direction;
  if (target < 0 || target >= items.length) {
    return items;
  }
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}
export function programPayload(draft: ProgramDraft) {
  if (!draft.sessions.length || !draft.sessions.some((session) => session.exercises.length)) {
    throw new Error('Add at least one session and exercise.');
  }
  const normalized = {
    ...draft,
    sessionsPerCycle: draft.sessions.length,
    sessions: draft.sessions.map((session, index) => ({
      ...session,
      position: index,
      exercises: session.exercises.map((exercise, index) => ({ ...exercise, position: index })),
    })),
  };
  return { program: ProgramWriteSchema.parse(normalized) };
}

export function normalizeSupersets<T extends { supersetGroup?: number | null }>(
  items: T[],
): T[] {
  const groups = new Map<number, number[]>();
  items.forEach((item, index) => {
    if (item.supersetGroup != null)
      groups.set(item.supersetGroup, [...(groups.get(item.supersetGroup) ?? []), index]);
  });
  const broken = new Set(
    [...groups]
      .filter(
        ([, positions]) =>
          positions.length < 2 ||
          positions.some((at, index) => index > 0 && at !== positions[index - 1] + 1),
      )
      .map(([group]) => group),
  );
  return items.map((item) =>
    item.supersetGroup != null && broken.has(item.supersetGroup)
      ? { ...item, supersetGroup: null }
      : item,
  );
}
