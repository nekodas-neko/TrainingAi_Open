import type { StyleSet } from '@trainingai/shared/types/progression';
import type { WorkoutExercise } from '@/app/api/workout-data/route';
import type {
  LocalProgram, LocalProgramSession, LocalSessionExercise,
  LocalProgressionStyle, LocalStyleSet, LocalExerciseLibraryEntry,
} from './types';

export interface LocalProgramRows {
  programs:    LocalProgram[];
  sessions:    LocalProgramSession[];
  exercises:   LocalSessionExercise[];
  styles:      LocalProgressionStyle[];
  styleSets:   LocalStyleSet[];
  /** The mirrored exercise catalogue. Absent (or missing an entry) falls back to
   *  'weighted' — the pre-Q-20 behaviour, now a fallback rather than the only answer. */
  library?:    LocalExerciseLibraryEntry[];
}

export interface LocalActiveProgram {
  id:           string;
  name:         string;
  phaseMode:    string;
  trainingGoal: string;
  sessions: Array<{
    id:        string;
    name:      string;
    position:  number;
    exercises: WorkoutExercise[];
  }>;
}

// Pure reassembly: raw local rows → the program structure the workout screen
// renders offline. Server-computed fields (last weights, 1RM estimates, "logged
// today", phase-resolved style) are intentionally null/empty — the offline read
// paints the *structure* (sessions, exercises, per-set progression) only.
export function assembleLocalActiveProgram(rows: LocalProgramRows): LocalActiveProgram | null {
  const program = rows.programs.find(p => p.isActive) ?? rows.programs[0];
  if (!program) return null;

  const setsByStyleId = new Map<string, LocalStyleSet[]>();
  for (const ss of rows.styleSets) {
    const list = setsByStyleId.get(ss.styleId) ?? [];
    list.push(ss);
    setsByStyleId.set(ss.styleId, list);
  }
  for (const list of setsByStyleId.values()) list.sort((a, b) => a.setNumber - b.setNumber);

  const styleNameById = new Map(rows.styles.map(st => [st.id, st.name]));
  // Keyed by lower-cased name to match the server's own `libByName` lookup
  // (lib/workout/session-data.ts) — the two must agree or an exercise types one way
  // online and the other offline.
  const libByName = new Map((rows.library ?? []).map(e => [e.nameKey, e]));

  const sessions = rows.sessions
    .filter(sess => sess.programId === program.id)
    .sort((a, b) => a.position - b.position)
    .map(sess => {
      const exercises = rows.exercises
        .filter(ex => ex.sessionId === sess.id)
        .sort((a, b) => a.position - b.position)
        .map(ex => buildWorkoutExercise(ex, setsByStyleId, styleNameById, libByName));
      return { id: sess.id, name: sess.name, position: sess.position, exercises };
    });

  return {
    id:           program.id,
    name:         program.name,
    phaseMode:    program.phaseMode,
    trainingGoal: program.trainingGoal,
    sessions,
  };
}

function buildWorkoutExercise(
  ex: LocalSessionExercise,
  setsByStyleId: Map<string, LocalStyleSet[]>,
  styleNameById: Map<string, string>,
  libByName: Map<string, LocalExerciseLibraryEntry>,
): WorkoutExercise {
  const lib = libByName.get(ex.exerciseName.toLowerCase());
  const sets = ex.styleId ? setsByStyleId.get(ex.styleId) ?? null : null;
  const progressionStyle = sets?.length
    ? sets.map(ss => ({ pct: ss.pct, reps: ss.reps, restSec: ss.restSec, useFor1rm: ss.useFor1rm } as StyleSet))
    : null;

  return {
    name:                 ex.exerciseName,
    sessionExerciseId:    ex.id,
    latestWeight:         null,
    lastSetWeights:       [],
    estimated1rm:         null,
    // The local mirror doesn't hold personal_records; the network fetch fills the
    // real all-time PR. The E1-7 badge only renders after a set is logged (post-fetch).
    allTimePr1rm:         null,
    target80:             null,
    lastDate:             null,
    defaultSets:          progressionStyle?.length ?? 3,
    lastSets:             null,
    lastReps:             [],
    progressionStyle,
    styleName:            ex.styleId ? styleNameById.get(ex.styleId) ?? null : null,
    styleId:              ex.styleId ?? undefined,
    exerciseRole:         ex.exerciseRole || 'primary',
    muscleGroups:         ex.muscleGroups,
    mainMuscles:          lib?.muscles.filter(m => m.role === 'main').map(m => m.muscle) ?? ex.muscleGroups,
    secondaryMuscles:     lib?.muscles.filter(m => m.role === 'secondary').map(m => m.muscle) ?? [],
    instructions:         undefined,
    exerciseType:         lib?.exerciseType ?? 'weighted',
    loggedTodayInSession: false,
    supersetGroup:        ex.supersetGroup,
  };
}

/**
 * Pull the catalogue facts out of a server `WorkoutExercise[]` so they can be mirrored
 * locally. The server is the only place that knows an exercise's type — offline reads
 * previously had to assume 'weighted' (Q-20) — so every response that carries these
 * fields is an opportunity to teach the mirror.
 *
 * Exercises whose type the server itself defaulted are still written: 'weighted' from the
 * server is a real answer, and a row that is never written can never correct a stale one.
 */
export function exerciseLibraryRowsFrom(
  exercises: Pick<WorkoutExercise, 'name' | 'exerciseType' | 'mainMuscles' | 'secondaryMuscles' | 'equipment'>[],
  now: string,
): LocalExerciseLibraryEntry[] {
  const byKey = new Map<string, LocalExerciseLibraryEntry>();
  for (const ex of exercises) {
    if (!ex?.name) continue;
    byKey.set(ex.name.toLowerCase(), {
      nameKey:      ex.name.toLowerCase(),
      id:           null,
      name:         ex.name,
      exerciseType: ex.exerciseType === 'bodyweight' ? 'bodyweight' : 'weighted',
      muscles: [
        ...(ex.mainMuscles ?? []).map(m => ({ muscle: m, role: 'main' })),
        ...(ex.secondaryMuscles ?? []).map(m => ({ muscle: m, role: 'secondary' })),
      ],
      equipment:    ex.equipment?.length ? ex.equipment.join(',') : null,
      updatedAt:    now,
    });
  }
  return [...byKey.values()];
}
