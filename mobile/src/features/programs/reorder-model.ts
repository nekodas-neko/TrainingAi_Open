import type { ProgramDraft } from './editor-model';

type Exercise = ProgramDraft['sessions'][number]['exercises'][number];

export function identifyProgramDraft(draft: ProgramDraft, uuid: () => string): ProgramDraft {
  if (draft.sessions.every((session) => session.id && session.exercises.every((item) => item.id))) {
    return draft;
  }
  return {
    ...draft,
    sessions: draft.sessions.map((session) => ({
      ...session,
      id: session.id || uuid(),
      exercises: session.exercises.map((item) => ({
        ...item,
        id: item.id || uuid(),
      })),
    })),
  };
}

export function exerciseBlocks(exercises: Exercise[]) {
  const blocks: { id: string; exercises: Exercise[] }[] = [];
  const groups = new Map<number, (typeof blocks)[number]>();
  for (const exercise of exercises) {
    const group = exercise.supersetGroup;
    if (group == null) {
      blocks.push({ id: exercise.id!, exercises: [exercise] });
    } else {
      let block = groups.get(group);
      if (!block) {
        block = { id: `superset:${group}`, exercises: [] };
        groups.set(group, block);
        blocks.push(block);
      }
      block.exercises.push(exercise);
    }
  }
  return blocks;
}

function ordered<T>(items: T[], keys: string[], key: (item: T) => string) {
  const byId = new Map(items.map((item) => [key(item), item]));
  if (
    keys.length !== items.length ||
    new Set(keys).size !== keys.length ||
    keys.some((id) => !byId.has(id))
  )
    return null;
  return keys.map((id) => byId.get(id)!);
}

export function reorderSessions(draft: ProgramDraft, keys: string[]): ProgramDraft {
  const sessions = ordered(draft.sessions, keys, (session) => session.id!);
  return sessions
    ? {
        ...draft,
        sessions: sessions.map((session, position) => ({
          ...session,
          position,
        })),
      }
    : draft;
}

export function reorderExerciseBlocks(exercises: Exercise[], keys: string[]): Exercise[] {
  const blocks = ordered(exerciseBlocks(exercises), keys, (block) => block.id);
  return blocks
    ? blocks
        .flatMap((block) => block.exercises)
        .map((exercise, position) => ({ ...exercise, position }))
    : exercises;
}

export function reorderSupersetMembers(
  exercises: Exercise[],
  group: number,
  keys: string[],
): Exercise[] {
  const members = ordered(
    exercises.filter((item) => item.supersetGroup === group),
    keys,
    (item) => item.id!,
  );
  if (!members) return exercises;
  let index = 0;
  return exercises.map((item, position) =>
    item.supersetGroup === group ? { ...members[index++], position } : item,
  );
}
