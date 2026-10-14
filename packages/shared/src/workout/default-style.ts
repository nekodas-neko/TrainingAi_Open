import type { ExerciseRole } from "../types/program";

type StyledSlot = { styleId?: string | null; exerciseRole?: ExerciseRole };
export function defaultStyleIdForSlot(
  sessions: readonly { exercises: readonly StyledSlot[] }[],
  styles: readonly { id: string }[],
  role?: ExerciseRole,
) {
  const known = new Set(styles.map((style) => style.id));
  return (
    mostUsedStyleId(sessions, role, (id) => known.has(id)) ?? styles[0]?.id
  );
}
export function mostUsedStyleId(
  sessions: readonly { exercises: readonly StyledSlot[] }[],
  role?: ExerciseRole,
  isKnown: (id: string) => boolean = () => true,
) {
  const used = sessions
    .flatMap((session) => session.exercises)
    .filter(
      (exercise): exercise is StyledSlot & { styleId: string } =>
        !!exercise.styleId && isKnown(exercise.styleId),
    );
  const matching =
    role == null
      ? []
      : used.filter((exercise) => exercise.exerciseRole === role);
  return (
    mostUsed(matching.map((exercise) => exercise.styleId)) ??
    mostUsed(used.map((exercise) => exercise.styleId))
  );
}
function mostUsed(ids: readonly string[]) {
  const counts = new Map<string, number>();
  for (const id of ids) {
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  let best: string | undefined;
  let total = 0;
  for (const [id, count] of counts) {
    if (count > total) {
      best = id;
      total = count;
    }
  }
  return best;
}
