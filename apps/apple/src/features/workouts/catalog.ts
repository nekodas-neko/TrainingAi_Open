import { normalizeMuscle } from '@trainingai/shared/muscles';
import { daysBetweenDateStrs, isCalendarDate, toAestDay } from '@trainingai/shared/date-utils';

export type MuscleAssignment = { muscle: string; role: 'main' | 'secondary' };
export type MuscleRecovery = { muscle: string; pct: number };
export type SetPreview = {
  number: number;
  reps: number;
  percent: number;
  restSeconds: number;
  useFor1rm?: boolean;
};
export type ExercisePreview = {
  id: string;
  name: string;
  muscles: string[];
  sets: SetPreview[];
  setCount: number;
  style: string | null;
  instructions: string | null;
  exerciseType: 'weighted' | 'bodyweight';
  deloaded: boolean;
  lastWeights: number[];
  equipment: string[];
  estimated1rm: number | null;
  target80: number | null;
  latestWeight: number | null;
  lastSetMode: 'amrap' | 'plus1' | null;
  mainMuscles?: string[];
  secondaryMuscles?: string[];
  lastReps?: number[];
  lastDate?: string | null;
  prevRepMaxReps?: number | null;
  supersetGroup?: number | null;
  preDeload?: { pct: number; reps: number; sets: number } | null;
  loggedDate?: string | null;
  preDeloadStyle?: SetPreview[] | null;
  preDeloadSets?: number | null;
};
export type SessionPreview = {
  id: string;
  name: string;
  position: number;
  durationMinutes: number | null;
  exercises: ExercisePreview[];
  phase: string | null;
  prescriptionPending: boolean;
  isBaseline: boolean;
  icon?: string | null;
  phaseDetail?: string | null;
  lastTrained?: string | null;
  trainedDate?: string | null;
  muscleActivations?: MuscleAssignment[];
  budgetMinutes?: number | null;
};
export type WorkoutProgram = {
  id: string;
  name: string;
  phaseMode: string;
  sessions: SessionPreview[];
};
export type WorkoutCatalog = {
  version: 2;
  origin: string;
  userId: string;
  savedAt: number;
  program: WorkoutProgram | null;
  recommendation: {
    sessionId: string | null;
    isRestDay: boolean;
    reason: string;
    deloadOrRestRecommended?: boolean;
    temperatureAlert?: boolean;
    consecutiveTrainingDays?: number;
  };
  recovery?: MuscleRecovery[] | null;
};
export type CatalogIdentity = { origin: string; userId: string };

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid workout response.');
  }
  return value as Record<string, unknown>;
}
function text(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error('Missing workout identity or name.');
  }
  return value;
}
function number(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error('Invalid workout number.');
  }
  return value;
}
function array(value: unknown): unknown[] {
  if (!Array.isArray(value)) {
    throw new Error('Invalid workout list.');
  }
  return value;
}
function optionalText(value: unknown) {
  if (value == null || value === '') {
    return null;
  }
  return text(value);
}
function optionalDate(value: unknown) {
  const date = optionalText(value);
  if (date && !isCalendarDate(date)) {
    throw new Error('Invalid workout date.');
  }
  return date?.replace(/\//g, '-') ?? null;
}
export function sessionTrainingStatus(
  session: SessionPreview,
  completedDates: string[],
  timezone: string,
  at = new Date(),
) {
  const today = toAestDay(at, timezone);
  const dates = completedDates.map((date) => date.replace(/\//g, '-'));
  const completed = session.trainedDate?.replace(/\//g, '-') === today || dates.includes(today);
  const previous = [session.lastTrained?.replace(/\//g, '-'), ...dates]
    .filter((date): date is string => !!date && date < today)
    .sort()
    .at(-1);
  const days = previous ? daysBetweenDateStrs(previous, today) : null;
  return {
    completed,
    lastTrained:
      days === null
        ? 'Never trained'
        : days === 1
          ? 'Last done yesterday'
          : `Last done ${days} days ago`,
  };
}
function count(value: unknown): number {
  const result = number(value);
  if (!Number.isSafeInteger(result)) {
    throw new Error('Invalid workout count.');
  }
  return result;
}
function duration(value: unknown) {
  return value == null ? null : number(value);
}
function load(value: unknown) {
  if (value == null) {
    return null;
  }
  if (typeof value !== 'number' || !Number.isFinite(value) || value < -100 || value > 500) {
    throw new Error('Invalid exercise load.');
  }
  return value;
}
function unique(ids: string[]) {
  if (new Set(ids).size !== ids.length) {
    throw new Error('Duplicate workout identity.');
  }
}
function exercise(value: unknown, dataDate: string | null = null): ExercisePreview {
  const row = object(value);
  const sets =
    row.progressionStyle == null
      ? []
      : array(row.progressionStyle).map((value, index) => {
          const set = object(value);
          return {
            number: index + 1,
            reps: count(set.reps),
            percent: number(set.pct),
            restSeconds: number(set.restSec),
            ...(typeof set.useFor1rm === 'boolean' ? { useFor1rm: set.useFor1rm } : {}),
          };
        });
  return {
    id: text(row.sessionExerciseId),
    name: text(row.name),
    muscles: row.muscleGroups == null ? [] : [...new Set(array(row.muscleGroups).map(text))],
    sets,
    setCount: row.progressionStyle == null ? count(row.defaultSets) : sets.length,
    style: optionalText(row.styleName),
    instructions:
      typeof row.instructions === 'string' && row.instructions.trim() ? row.instructions : null,
    exerciseType: row.exerciseType === 'bodyweight' ? 'bodyweight' : 'weighted',
    deloaded: row.deloaded === true,
    equipment: row.equipment == null ? [] : array(row.equipment).map(text),
    estimated1rm: duration(row.estimated1rm),
    target80: load(row.target80),
    latestWeight: load(row.latestWeight),
    lastSetMode:
      row.lastSetMode === 'amrap' || row.lastSetMode === 'plus1' ? row.lastSetMode : null,
    lastWeights:
      row.lastSetWeights == null
        ? []
        : array(row.lastSetWeights).map((value) => {
            if (
              typeof value !== 'number' ||
              !Number.isFinite(value) ||
              value < -100 ||
              value > 500
            ) {
              throw new Error('Invalid previous weight.');
            }
            return value;
          }),
    mainMuscles: row.mainMuscles == null ? [] : array(row.mainMuscles).map(text),
    secondaryMuscles: row.secondaryMuscles == null ? [] : array(row.secondaryMuscles).map(text),
    lastReps: row.lastReps == null ? [] : array(row.lastReps).map(count),
    lastDate: optionalDate(row.lastDate),
    prevRepMaxReps: row.prevRepMaxReps == null ? null : count(row.prevRepMaxReps),
    supersetGroup: row.supersetGroup == null ? null : count(row.supersetGroup),
    preDeload:
      row.preDeload == null
        ? null
        : {
            pct: number(object(row.preDeload).pct),
            reps: count(object(row.preDeload).reps),
            sets: count(object(row.preDeload).sets),
          },
    loggedDate: row.loggedTodayInSession === true ? dataDate : null,
    preDeloadSets: row.preDeloadSets == null ? null : count(row.preDeloadSets),
    preDeloadStyle:
      row.preDeloadStyle == null
        ? null
        : array(row.preDeloadStyle).map((value, index) => {
            const set = object(value);
            return {
              number: index + 1,
              reps: count(set.reps),
              percent: number(set.pct),
              restSeconds: number(set.restSec),
              useFor1rm: typeof set.useFor1rm === 'boolean' ? set.useFor1rm : undefined,
            };
          }),
  };
}

export function buildCatalog(
  metaValue: unknown,
  nextValue: unknown,
  allValue: unknown,
  identity: CatalogIdentity,
  now = Date.now(),
): WorkoutCatalog {
  const meta = object(metaValue);
  const next = object(nextValue);
  if (typeof next.isRestDay !== 'boolean') {
    throw new Error('Invalid session recommendation.');
  }
  const recommendation = {
    sessionId: next.session == null ? null : text(object(next.session).id),
    isRestDay: next.isRestDay,
    reason: text(next.reason),
    ...(typeof next.deloadOrRestRecommended === 'boolean'
      ? { deloadOrRestRecommended: next.deloadOrRestRecommended }
      : {}),
    ...(typeof next.temperatureAlert === 'boolean'
      ? { temperatureAlert: next.temperatureAlert }
      : {}),
    ...(typeof next.consecutiveTrainingDays === 'number'
      ? { consecutiveTrainingDays: count(next.consecutiveTrainingDays) }
      : {}),
  };
  const base = {
    version: 2 as const,
    origin: identity.origin,
    userId: identity.userId,
    savedAt: now,
    recommendation,
    recovery: null,
  };
  if (!meta.program) {
    if (
      array(meta.exercises).length ||
      array(meta.sessions).length ||
      recommendation.sessionId
    ) {
      throw new Error('Inconsistent program response.');
    }
    return { ...base, program: null };
  }
  const program = object(meta.program);
  if (program.userId !== identity.userId || program.isActive !== true) {
    throw new Error('The program belongs to a different account.');
  }
  const programId = text(program.id);
  const perSession = object(object(allValue).perSession);
  const estimates =
    meta.estimatedMinBySession == null ? {} : object(meta.estimatedMinBySession);
  const sessions = array(program.sessions)
    .map((value): SessionPreview => {
      const session = object(value);
      const id = text(session.id);
      const data = object(perSession[id]);
      const dataProgram = object(data.program);
      if (
        session.programId !== programId ||
        object(data.session).id !== id ||
        dataProgram.id !== programId ||
        dataProgram.userId !== identity.userId
      ) {
        throw new Error('The program changed while loading.');
      }
      const exercises = array(data.exercises).map((value) =>
        exercise(value, optionalDate(data.dataDate)),
      );
      const allowed = new Set(array(session.exercises).map((value) => text(object(value).id)));
      if (exercises.some((value) => !allowed.has(value.id))) {
        throw new Error('An exercise belongs to a different session.');
      }
      unique(exercises.map((value) => value.id));
      const phase =
        data.phaseStatus == null ? null : text(object(object(data.phaseStatus).phase).name);
      const phaseStatus = data.phaseStatus == null ? null : object(data.phaseStatus);
      const phaseDetail = !phaseStatus
        ? null
        : phaseStatus.isDeloadActive
          ? object(phaseStatus.phase).phaseType === 'deload'
            ? 'Deload Week'
            : 'Recovery Week'
          : phaseStatus.openEnded && typeof phaseStatus.phaseSessionNumber === 'number'
            ? `${phase} · Session ${phaseStatus.phaseSessionNumber}`
            : typeof phaseStatus.cycleInPhase === 'number' &&
                typeof phaseStatus.totalPhaseCycles === 'number'
              ? `${phase} · Cycle ${phaseStatus.cycleInPhase}/${phaseStatus.totalPhaseCycles}`
              : phase;
      const dates = array(data.exercises)
        .map((value) => optionalDate(object(value).lastDate))
        .filter((value): value is string => !!value)
        .sort();
      const muscleActivations = [
        ...new Set(exercises.flatMap((value) => value.muscles).map(normalizeMuscle)),
      ].map((muscle) => ({ muscle, role: 'main' as const }));
      if (typeof data.aiPrescriptionPending !== 'boolean') {
        throw new Error('Invalid prescription status.');
      }
      return {
        id,
        name: text(session.name),
        position: count(session.position),
        durationMinutes: duration(estimates[id]),
        exercises,
        phase,
        prescriptionPending: data.aiPrescriptionPending,
        isBaseline: data.phaseStatus != null && object(data.phaseStatus).isBaseline === true,
        icon: optionalText(session.icon),
        phaseDetail,
        lastTrained: dates.at(-1) ?? null,
        trainedDate: array(data.exercises).some(
          (value) => object(value).loggedTodayInSession === true,
        )
          ? optionalDate(data.dataDate)
          : null,
        muscleActivations,
        budgetMinutes: duration(session.timeBudgetMinutes),
      };
    })
    .sort((a, b) => a.position - b.position);
  unique(sessions.map((value) => value.id));
  if (
    recommendation.sessionId &&
    !sessions.some((value) => value.id === recommendation.sessionId)
  ) {
    throw new Error('The recommended session is no longer in this program.');
  }
  if (recommendation.sessionId && next.estimatedDurationMin != null) {
    sessions.find((value) => value.id === recommendation.sessionId)!.durationMinutes = duration(
      next.estimatedDurationMin,
    );
  }
  return {
    ...base,
    program: {
      id: programId,
      name: text(program.name),
      phaseMode: text(program.phaseMode),
      sessions,
    },
  };
}

export function readSavedCatalog(
  raw: string | null,
  identity: CatalogIdentity,
): WorkoutCatalog | null {
  if (!raw) {
    return null;
  }
  try {
    const saved = object(JSON.parse(raw));
    if (
      saved.version !== 2 ||
      saved.origin !== identity.origin ||
      saved.userId !== identity.userId
    ) {
      return null;
    }
    number(saved.savedAt);
    const recommendation = object(saved.recommendation);
    text(recommendation.reason);
    if (typeof recommendation.isRestDay !== 'boolean') {
      return null;
    }
    const sessionId = recommendation.sessionId === null ? null : text(recommendation.sessionId);
    for (const key of ['deloadOrRestRecommended', 'temperatureAlert']) {
      if (recommendation[key] !== undefined && typeof recommendation[key] !== 'boolean') {
        return null;
      }
    }
    if (recommendation.consecutiveTrainingDays !== undefined) {
      count(recommendation.consecutiveTrainingDays);
    }
    if (saved.program !== null) {
      const program = object(saved.program);
      text(program.id);
      text(program.name);
      text(program.phaseMode);
      const sessions = array(program.sessions);
      const ids = sessions.map((value) => {
        const session = object(value);
        session.icon = optionalText(session.icon);
        session.phaseDetail = optionalText(session.phaseDetail);
        session.lastTrained = optionalDate(session.lastTrained);
        session.trainedDate = optionalDate(session.trainedDate);
        session.budgetMinutes = duration(session.budgetMinutes);
        if (session.muscleActivations != null) {
          session.muscleActivations = readAssignments(session.muscleActivations);
        }
        text(session.name);
        count(session.position);
        if (session.durationMinutes !== null) {
          number(session.durationMinutes);
        }
        if (session.phase !== null) {
          text(session.phase);
        }
        if (
          typeof session.prescriptionPending !== 'boolean' ||
          typeof session.isBaseline !== 'boolean'
        ) {
          throw new Error('Invalid saved prescription status.');
        }
        const exercises = array(session.exercises);
        unique(
          exercises.map((value) => {
            const row = object(value);
            text(row.name);
            array(row.muscles).forEach(text);
            count(row.setCount);
            row.equipment = row.equipment == null ? [] : array(row.equipment).map(text);
            row.estimated1rm = duration(row.estimated1rm);
            row.target80 = load(row.target80);
            row.latestWeight = load(row.latestWeight);
            if (
              row.lastSetMode != null &&
              !['amrap', 'plus1'].includes(String(row.lastSetMode))
            ) {
              throw new Error('Invalid saved set mode.');
            }
            row.lastSetMode ??= null;
            row.mainMuscles = row.mainMuscles == null ? [] : array(row.mainMuscles).map(text);
            row.secondaryMuscles =
              row.secondaryMuscles == null ? [] : array(row.secondaryMuscles).map(text);
            row.lastReps = row.lastReps == null ? [] : array(row.lastReps).map(count);
            row.lastDate = optionalDate(row.lastDate);
            row.prevRepMaxReps = row.prevRepMaxReps == null ? null : count(row.prevRepMaxReps);
            row.supersetGroup = row.supersetGroup == null ? null : count(row.supersetGroup);
            row.loggedDate = optionalDate(row.loggedDate);
            row.preDeloadSets = row.preDeloadSets == null ? null : count(row.preDeloadSets);
            if (row.preDeloadStyle != null) {
              array(row.preDeloadStyle).forEach((value) => {
                const set = object(value);
                count(set.number);
                count(set.reps);
                number(set.percent);
                number(set.restSeconds);
              });
            }
            if (row.preDeload != null) {
              const before = object(row.preDeload);
              number(before.pct);
              count(before.reps);
              count(before.sets);
            }
            if (
              !['weighted', 'bodyweight'].includes(String(row.exerciseType)) ||
              typeof row.deloaded !== 'boolean'
            ) {
              throw new Error('Invalid saved exercise.');
            }
            array(row.lastWeights).forEach((value) => {
              if (
                typeof value !== 'number' ||
                !Number.isFinite(value) ||
                value < -100 ||
                value > 500
              ) {
                throw new Error('Invalid saved weight.');
              }
            });
            if (row.style !== null) {
              text(row.style);
            }
            if (row.instructions !== null) {
              text(row.instructions);
            }
            unique(
              array(row.sets).map((value) => {
                const set = object(value);
                count(set.number);
                count(set.reps);
                number(set.percent);
                number(set.restSeconds);
                if (set.useFor1rm !== undefined && typeof set.useFor1rm !== 'boolean') {
                  throw new Error('Invalid saved set.');
                }
                return String(set.number);
              }),
            );
            return text(row.id);
          }),
        );
        return text(session.id);
      });
      unique(ids);
      if (sessionId && !ids.includes(sessionId)) {
        return null;
      }
    } else if (sessionId) {
      return null;
    }
    saved.recovery = saved.recovery == null ? null : readRecovery({ muscles: saved.recovery });
    return saved as WorkoutCatalog;
  } catch {
    return null;
  }
}

function readAssignments(value: unknown): MuscleAssignment[] {
  return array(value).map((value) => {
    const row = object(value);
    if (row.role !== 'main' && row.role !== 'secondary') {
      throw new Error('Invalid muscle assignment.');
    }
    return { muscle: normalizeMuscle(text(row.muscle)), role: row.role };
  });
}

export function readExerciseMuscles(value: unknown): Map<string, MuscleAssignment[]> {
  return new Map(
    array(object(value).exercises).map((value) => {
      const row = object(value);
      return [text(row.name).toLowerCase(), readAssignments(row.muscles)];
    }),
  );
}

export function readRecovery(value: unknown): MuscleRecovery[] {
  return array(object(value).muscles)
    .map((value) => {
      const row = object(value);
      const pct = number(row.pct);
      if (pct > 100) {
        throw new Error('Invalid muscle recovery.');
      }
      return { muscle: normalizeMuscle(text(row.muscle)), pct };
    })
    .sort((a, b) => a.pct - b.pct || a.muscle.localeCompare(b.muscle));
}

export function applyMuscleLibrary(
  catalog: WorkoutCatalog,
  library: Map<string, MuscleAssignment[]>,
) {
  for (const session of catalog.program?.sessions ?? []) {
    const seen = new Map<string, 'main' | 'secondary'>();
    for (const exercise of session.exercises) {
      const assignments =
        library.get(exercise.name.toLowerCase()) ??
        exercise.muscles.map((muscle) => ({
          muscle: normalizeMuscle(muscle),
          role: 'main' as const,
        }));
      for (const assignment of assignments) {
        if (!seen.has(assignment.muscle) || assignment.role === 'main') {
          seen.set(assignment.muscle, assignment.role);
        }
      }
    }
    session.muscleActivations = [...seen].map(([muscle, role]) => ({ muscle, role }));
  }
}

export function readSessionResponse(
  value: unknown,
  identity: CatalogIdentity,
  programId: string,
  sessionId: string,
): SessionPreview {
  const data = object(value);
  const program = object(data.program);
  const session = object(data.session);
  if (program.id !== programId || session.id !== sessionId) {
    throw new Error('The program changed. Refresh it before starting.');
  }
  const catalog = buildCatalog(
    { program: { ...program, sessions: [session] } },
    { isRestDay: false, reason: 'Selected session', session },
    { perSession: { [sessionId]: data } },
    identity,
  );
  return catalog.program!.sessions[0];
}
