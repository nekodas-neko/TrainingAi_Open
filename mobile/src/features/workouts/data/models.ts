import { z } from 'zod';
import { ProgramWriteSchema } from '@trainingai/shared/validation/program-write';
import { normalizeMuscle } from '@trainingai/shared/muscles';
import type { ResourceSpec } from './WorkoutResources';

const finite = z.number().finite();
const text = z.string();
const assignment = z.object({
  muscle: text.transform(normalizeMuscle),
  role: z.enum(['main', 'secondary']),
});
export const LibraryExerciseSchema = z
  .object({
    id: text,
    name: text,
    muscles: z.array(assignment).default([]),
    equipment: z.array(text).default([]),
    instructions: text.nullish(),
    exerciseType: z.enum(['weighted', 'bodyweight']).default('weighted'),
    mergedInto: text.nullish().transform((value) => value ?? undefined),
  })
  .passthrough();
export type LibraryExercise = z.infer<typeof LibraryExerciseSchema>;
export const librarySpec = {
  path: '/api/exercise-library',
  schema: z.object({ exercises: z.array(LibraryExerciseSchema) }),
  ttl: 86_400_000,
};
export const programSpec = {
  path: '/api/workout-templates',
  schema: z.object({
    programs: z.array(
      ProgramWriteSchema.extend({
        id: text,
        userId: text,
        sessions: ProgramWriteSchema.shape.sessions.unwrap(),
      }),
    ),
  }),
  ttl: 300_000,
};
export type SavedProgram = z.infer<typeof programSpec.schema>['programs'][number];
export const stylesSpec = {
  path: '/api/progression-styles',
  schema: z.object({
    styles: z.array(
      z
        .object({
          id: text,
          name: text,
          sets: z.array(
            z
              .object({
                id: text.optional(),
                setNumber: finite,
                pct: finite,
                reps: finite,
                restSec: finite,
                useFor1rm: z.boolean().default(true),
              })
              .passthrough(),
          ),
        })
        .passthrough(),
    ),
  }),
  ttl: 86_400_000,
};
export type SavedStyle = z.infer<typeof stylesSpec.schema>['styles'][number];
export const phaseSetsSpec = {
  path: '/api/phase-sets',
  schema: z.object({
    phaseSets: z.array(
      z
        .object({
          id: text,
          name: text,
          isDefault: z.boolean().default(false),
          ownerProgramId: text.nullish(),
          phases: z.array(
            z
              .object({
                id: text.optional(),
                name: text,
                position: finite,
                durationCycles: finite,
                phaseType: z.enum([
                  'normal',
                  'peak',
                  'deload',
                  'accessory',
                  'testing',
                  'baseline',
                ]),
                primaryStyleId: text.nullish(),
                secondaryStyleId: text.nullish(),
                primaryStyleName: text.nullish(),
              })
              .passthrough(),
          ),
        })
        .passthrough(),
    ),
  }),
  ttl: 86_400_000,
};
export type SavedPhaseSet = z.infer<typeof phaseSetsSpec.schema>['phaseSets'][number];
export const injurySpec = {
  path: '/api/injuries',
  schema: z.array(
    z.object({
      id: text,
      userId: text,
      muscleName: text,
      severity: z.enum(['mild', 'moderate', 'severe']),
      notes: text.nullable(),
      startedDate: text,
      resolvedDate: text.nullable(),
      createdAt: text,
      updatedAt: text,
    }),
  ),
  ttl: 300_000,
};
export const historySchema = z.object({
  exerciseType: z.enum(['weighted', 'bodyweight']),
  entries: z.array(
    z.object({
      date: text,
      sessionName: text,
      sets: finite,
      weightKg: z.array(finite),
      reps: z.array(finite),
      estimated1rm: finite.nullable(),
      volume: finite.nullable(),
      isDeload: z.boolean(),
      rpeDelta: finite.nullable(),
    }),
  ),
});
export const exerciseHistorySpec = (name: string) => ({
  path: '/api/exercise-history',
  query: { name },
  schema: historySchema,
  ttl: 300_000,
});
export const mediaSpec = (name: string) => ({
  path: '/api/exercise-gif',
  query: { name },
  schema: z.object({ gifUrl: text.nullable(), imageUrl: text.nullable() }),
  ttl: 86_400_000,
});
export const strengthSpec = {
  path: '/api/strength-trend',
  schema: z.object({
    exercises: z.array(
      z.object({
        name: text,
        exerciseType: z.enum(['weighted', 'bodyweight']),
        history: z.array(z.object({ date: text, rm: finite })),
        currentRm: finite,
        peakRm: finite,
        startRm: finite.nullable(),
        gainPct: finite.nullable(),
      }),
    ),
  }),
  ttl: 300_000,
};
export const recordsSpec = {
  path: '/api/personal-records',
  schema: z.object({
    records: z.array(
      z.object({ exerciseName: text, estimated1rm: finite, achievedAt: text }),
    ),
  }),
  ttl: 300_000,
};
export const weeklySpec = {
  path: '/api/weekly-stats',
  schema: z.object({
    days: z.array(
      z.object({
        dateKey: text,
        label: text,
        sessions: z.array(text),
        volume: finite,
        deloadVolume: finite,
        isDeload: z.boolean(),
        isTesting: z.boolean(),
      }),
    ),
    totalSessions: finite,
    totalSets: finite,
    totalVolumeKg: finite,
    avgIntensityPct: finite.nullable(),
    avgDurationMin: finite.nullable(),
  }),
  ttl: 300_000,
};
export const calendarSpec = (year: number, month: number) => ({
  path: '/api/calendar-data',
  query: { year: String(year), month: String(month) },
  schema: z.object({
    trainedDays: z.record(text, z.array(text)),
    activityDays: z.record(text, z.array(text)),
  }),
  ttl: 300_000,
});
export const dayExerciseSchema = z.object({
  name: text,
  sessionName: text,
  exerciseType: text.nullable(),
  weightKg: finite.nullable(),
  setWeights: z.array(finite),
  sets: finite.nullable(),
  reps: z.array(finite),
  timeToCompleteSet: finite.nullable(),
  loggedAt: text.nullable(),
  exerciseLogId: text,
  workoutSessionId: text,
});
export type DayExercise = z.infer<typeof dayExerciseSchema>;
export const daySpec = (date: string) => ({
  path: '/api/day-log',
  query: { date },
  schema: z
    .object({
      date: text,
      exercises: z.array(dayExerciseSchema),
      workoutDurationsById: z
        .record(text, z.object({ start: text, end: text, minutes: finite }).nullable())
        .optional(),
    })
    .passthrough(),
  ttl: 300_000,
});
export const recapSpec = (id: string) => ({
  path: `/api/workout-sessions/${id}/recap`,
  schema: z.object({ recap: text.optional(), degraded: z.boolean().optional() }),
  ttl: 86_400_000,
  cache: (data: { degraded?: boolean }) => !data.degraded,
});
const timingValues = {
  setupActualSec: finite.nullable(),
  setupExpectedSec: finite,
  workActualSec: finite.nullable(),
  workExpectedSec: finite,
  restActualSec: finite.nullable(),
  restExpectedSec: finite,
};
export const timingSpec = (id: string) => ({
  path: `/api/workout-sessions/${id}/timing`,
  schema: z.object({
    hasData: z.boolean(),
    exercises: z.array(z.object({ name: text, ...timingValues })),
    totals: z.object(timingValues),
    sources: z.object({ setup: text, work: text, rest: text }),
  }),
  ttl: 86_400_000,
});
export const workoutHrSpec = (id: string) => ({
  path: '/api/oura/hr-data',
  query: { sessionId: id },
  schema: z.object({
    ready: z.boolean(),
    hasData: z.boolean().optional(),
    startedAt: text.optional(),
    workoutHrvMs: finite.nullable().optional(),
    summary: z
      .object({
        avgBpm: finite.nullable(),
        peakBpm: finite.nullable(),
        hrr1Best: finite.nullable(),
        readingsCount: finite,
        source: text.nullable(),
        fromSnapshot: z.boolean(),
      })
      .nullable()
      .optional(),
    readings: z.array(z.object({ timestamp: text, bpm: finite })).default([]),
    setStats: z
      .array(
        z.object({
          exerciseName: text,
          setNumber: finite,
          loggedAt: text.nullable(),
          setStartMs: finite.nullable(),
          setEndMs: finite.nullable(),
          peakBpm: finite.nullable(),
          bpmAtLog: finite.nullable().optional(),
          hrr1: finite.nullable(),
          adequate: z.boolean().nullable(),
        }),
      )
      .default([]),
  }),
  ttl: 30_000,
});
export const nextPrescriptionSpec = {
  path: '/api/next-session/prescription',
  schema: z.object({
    isRestDay: z.boolean(),
    sessionName: text.optional(),
    source: z.enum(['driving', 'static', 'pending']).optional(),
    exercises: z
      .array(
        z.object({
          name: text,
          exerciseType: z.enum(['weighted', 'bodyweight']),
          sets: z.array(
            z.object({ weightKg: finite.nullable(), reps: finite, restSec: finite }),
          ),
        }),
      )
      .optional(),
  }),
  ttl: 300_000,
};
export const energySpec = (id: string, durationMinutes: number, activityId: number) => ({
  path: `/api/workout-sessions/${id}/energy`,
  query: { durationMin: String(durationMinutes), activityId: String(activityId) },
  schema: z.object({
    kcal: finite.nonnegative().nullable(),
    intensity: z.enum(['easy', 'moderate', 'hard']).optional(),
    source: z.enum(['hr', 'met']).optional(),
    reason: text.optional(),
  }),
  ttl: 300_000,
});
export const trainingStressSpec = (date: string) => ({
  path: '/api/training-stress',
  query: { date },
  schema: z.discriminatedUnion('status', [
    z.object({
      status: z.literal('ok'),
      ots: finite,
      high: z.boolean(),
      residualShare: finite.min(0).max(1).optional(),
      rhrFromDay: text.optional(),
    }),
    z.object({
      status: z.literal('gated'),
      reason: text,
      residualShare: finite.min(0).max(1).optional(),
    }),
  ]),
  ttl: 300_000,
});
const aiExercise = z
  .object({
    sessionExerciseId: text,
    name: text,
    sets: finite,
    reps: finite,
    pct: finite,
    restSec: finite,
    deloaded: z.boolean().optional(),
    rationale: text.optional(),
    preDeload: z.object({ pct: finite, reps: finite, sets: finite }).optional(),
  })
  .passthrough();
export const periodizationSchema = z.object({
  state: z
    .object({
      phase: text,
      phaseSessionCount: finite.optional(),
      phaseSessionTarget: finite.optional(),
      prescriptionStatus: text,
      prescription: z
        .object({
          phase: text,
          phaseAction: text,
          exercises: z.array(aiExercise),
          reasoning: text,
          deload: z.boolean(),
          estimatedSessionDurationMin: finite,
          fullSession: z
            .object({ estimatedSessionDurationMin: finite })
            .passthrough()
            .optional(),
        })
        .passthrough()
        .nullable()
        .optional(),
    })
    .passthrough()
    .nullable(),
  signals: z.unknown().optional(),
});
export const periodizationSpec = (
  id: string,
): ResourceSpec<z.infer<typeof periodizationSchema>> => ({
  path: `/api/ai-periodization/session/${id}`,
  schema: periodizationSchema,
  ttl: 60_000,
});
