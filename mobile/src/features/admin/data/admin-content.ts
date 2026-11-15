import { z } from 'zod';

/** The catalogue's reads are the same for everyone; they still skip the phone's disk so a stale list is never trusted offline. */
const noDiskCache = () => false;

export const EQUIPMENT_OPTIONS = ['barbell', 'dumbbell', 'cable', 'kettlebell', 'machine', 'bodyweight'];
export const MUSCLE_OPTIONS = [
  'Chest', 'Shoulders', 'Triceps', 'Biceps', 'Forearms',
  'Upper Back', 'Lats', 'Lower Back', 'Traps', 'Core',
  'Quads', 'Hamstrings', 'Glutes', 'Calves', 'Adductors',
];

const muscleSchema = z.object({ muscle: z.string(), role: z.enum(['main', 'secondary']) });
const exerciseSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    equipment: z.array(z.string()).default([]),
    muscles: z.array(muscleSchema).default([]),
    instructions: z.string().nullish(),
    exerciseType: z.enum(['weighted', 'bodyweight']).default('weighted'),
    gifUrl: z.string().nullable().default(null),
    imageUrl: z.string().nullable().default(null),
    mergedInto: z.string().nullish(),
  })
  .passthrough();
export type AdminExercise = z.infer<typeof exerciseSchema>;
export const adminExercisesSpec = {
  path: '/api/admin/exercises',
  ttl: 30_000,
  cache: noDiskCache,
  schema: z.object({ exercises: z.array(exerciseSchema) }).passthrough(),
};

const mediaRowSchema = z
  .object({
    gifUrl: z.string().nullable(),
    generatedAt: z.string().nullish(),
    modelUsed: z.string().nullish(),
  })
  .passthrough();
export const adminMediaSpec = {
  path: '/api/admin/generate-exercise-media',
  ttl: 30_000,
  cache: noDiskCache,
  schema: z
    .object({
      exercises: z.array(
        z.object({ name: z.string(), male: mediaRowSchema.nullable() }).passthrough(),
      ),
    })
    .passthrough(),
};
export const adminMediaReviewSpec = {
  path: '/api/admin/exercise-media-review',
  ttl: 30_000,
  cache: noDiskCache,
  schema: z
    .object({
      reviewed: z.array(
        z.object({ exerciseName: z.string(), gender: z.string(), reviewStatus: z.string() }).passthrough(),
      ),
    })
    .passthrough(),
};

export type GifSource = 'ai' | 'dataset' | 'custom' | null;
export const gifSourceLabel: Record<NonNullable<GifSource>, string> = {
  ai: 'AI',
  dataset: 'Dataset',
  custom: 'Custom',
};
type MediaMap = Record<string, z.infer<typeof mediaRowSchema> | undefined>;
export function mediaByName(data: z.infer<typeof adminMediaSpec.schema> | null): MediaMap {
  const map: MediaMap = {};
  for (const ex of data?.exercises ?? []) if (ex.male) map[ex.name.toLowerCase()] = ex.male;
  return map;
}
export function gifSource(name: string, libGifUrl: string | null, media: MediaMap): GifSource {
  const m = media[name.toLowerCase()];
  if (m?.gifUrl) return m.modelUsed === 'dataset-mirror' ? 'dataset' : 'ai';
  return libGifUrl ? 'custom' : null;
}
/** Verdicts already recorded: absence from the map IS "unreviewed". */
export function reviewedMap(data: z.infer<typeof adminMediaReviewSpec.schema> | null) {
  const map: Record<string, 'ok' | 'wrong'> = {};
  for (const r of data?.reviewed ?? [])
    if (r.gender === 'male' && (r.reviewStatus === 'ok' || r.reviewStatus === 'wrong'))
      map[r.exerciseName.toLowerCase()] = r.reviewStatus;
  return map;
}
/**
 * Coverage counts live exercises only: rows merged into another stay in the shared catalogue but
 * are not live, so counting them made full coverage unreachable. A custom URL counts as covered.
 */
export function coverage(exercises: readonly AdminExercise[], media: MediaMap) {
  const live = exercises.filter((e) => !e.mergedInto);
  const covered = live.filter(
    (e) => !!media[e.name.toLowerCase()]?.gifUrl || !!e.gifUrl || !!e.imageUrl,
  ).length;
  return { live: live.length, covered, merged: exercises.length - live.length };
}
/** The sweep queue: live exercises whose GIF is in `exercise_media` and have no verdict yet. */
export function reviewQueue(
  exercises: readonly AdminExercise[],
  media: MediaMap,
  reviewed: Record<string, 'ok' | 'wrong'>,
) {
  return exercises
    .filter((e) => !e.mergedInto && !!media[e.name.toLowerCase()]?.gifUrl && !reviewed[e.name.toLowerCase()])
    .map((e) => ({
      name: e.name,
      muscles: e.muscles.filter((m) => m.role === 'main').map((m) => m.muscle),
      equipment: e.equipment,
    }));
}
export const filterExercises = (exercises: readonly AdminExercise[], search: string) =>
  exercises.filter((e) => e.name.toLowerCase().includes(search.toLowerCase()));

export type ExerciseDraft = {
  name: string;
  equipment: string[];
  muscles: { muscle: string; role: 'main' | 'secondary' }[];
  instructions: string;
  exerciseType: 'weighted' | 'bodyweight';
  gifUrl: string;
  imageUrl: string;
};
export const emptyExerciseDraft: ExerciseDraft = {
  name: '', equipment: [], muscles: [], instructions: '', exerciseType: 'weighted', gifUrl: '', imageUrl: '',
};
export const draftFromExercise = (e: AdminExercise): ExerciseDraft => ({
  name: e.name,
  equipment: e.equipment,
  muscles: e.muscles,
  instructions: e.instructions ?? '',
  exerciseType: e.exerciseType,
  gifUrl: e.gifUrl ?? '',
  imageUrl: e.imageUrl ?? '',
});
/** The request body for POST / PATCH, built field by field. */
export const exerciseBody = (d: ExerciseDraft) => ({
  name: d.name.trim(),
  equipment: d.equipment,
  muscles: d.muscles,
  instructions: d.instructions || undefined,
  exerciseType: d.exerciseType,
  gifUrl: d.gifUrl || null,
  imageUrl: d.imageUrl || null,
});
/** Tapping a muscle's name makes it main; its 2° chip makes it secondary; tapping the same again removes it. */
export function toggleMuscle(
  muscles: ExerciseDraft['muscles'],
  muscle: string,
  role: 'main' | 'secondary',
): ExerciseDraft['muscles'] {
  const existing = muscles.find((m) => m.muscle === muscle);
  if (!existing) return [...muscles, { muscle, role }];
  if (existing.role === role) return muscles.filter((m) => m.muscle !== muscle);
  return muscles.map((m) => (m.muscle === muscle ? { ...m, role } : m));
}
export const toggleIn = (list: readonly string[], item: string) =>
  list.includes(item) ? list.filter((x) => x !== item) : [...list, item];

export const exerciseConfirm = {
  delete: {
    title: 'Delete exercise?',
    message:
      'this removes it from the shared library. Programs and history that reference it are not deleted, but it will no longer be pickable.',
    confirmLabel: 'Delete',
  },
  mirror: {
    title: 'Replace this GIF?',
    message:
      "it already has a GIF. Re-mirroring overwrites it with the dataset's version, and the current one is not kept.",
    confirmLabel: 'Replace',
  },
};

// Activity types
const activityTypeSchema = z
  .object({
    id: z.string(),
    label: z.string(),
    icon: z.string(),
    isDistanceBased: z.boolean(),
    sortOrder: z.number(),
  })
  .passthrough();
export type AdminActivityType = z.infer<typeof activityTypeSchema>;
export const adminActivityTypesSpec = {
  path: '/api/admin/activity-types',
  ttl: 30_000,
  cache: noDiskCache,
  schema: z.object({ activityTypes: z.array(activityTypeSchema) }).passthrough(),
};
export const activityTypeBody = (d: {
  label: string; icon: string; isDistanceBased: boolean; sortOrder: string;
}) => ({
  label: d.label.trim(),
  icon: d.icon.trim(),
  isDistanceBased: d.isDistanceBased,
  sortOrder: parseInt(d.sortOrder, 10) || 0,
});
export const activityDeleteConfirm = (label: string) => ({
  title: `Delete ${label}?`,
  message: `${label} is removed from the activity type list for every user, and it cannot be undone. If any logged activity still uses it, the delete is refused and nothing changes.`,
  confirmLabel: 'Delete',
});
/** Delete's refusals, in the words the current app's server gives; the request client keeps only the status. */
export function activityDeleteFailure(failure: unknown): string {
  const status = (failure as { status?: unknown } | null)?.status;
  if (status === 409) return 'Activity type is in use';
  if (status === 400) return "Cannot delete the 'other' activity type";
  return 'Delete failed';
}

// Exercise unit fix
export const adminUnitFixNamesSpec = {
  path: '/api/admin/fix-exercise-units',
  ttl: 60_000,
  cache: noDiskCache,
  schema: z.object({ exerciseNames: z.array(z.string()) }).passthrough(),
};
export const unitFixResultSchema = z
  .object({
    logs: z.array(
      z
        .object({
          exerciseLogId: z.string(),
          exerciseName: z.string(),
          loggedAt: z.string(),
          oldEstimated1rm: z.number().nullable(),
          newEstimated1rm: z.number().nullable(),
          oldVolume: z.number().nullable(),
          newVolume: z.number().nullable(),
          sets: z.array(
            z.object({
              setNumber: z.number(),
              reps: z.number(),
              oldWeightKg: z.number(),
              newWeightKg: z.number(),
            }),
          ),
        })
        .passthrough(),
    ),
    exercises: z.array(
      z
        .object({
          exerciseName: z.string(),
          oldPersonalRecord: z.number().nullable(),
          newPersonalRecord: z.number().nullable(),
        })
        .passthrough(),
    ),
    alreadyConverted: z.number().optional(),
  })
  .passthrough();
export type UnitFixResult = z.infer<typeof unitFixResultSchema>;
export const isDateInput = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);
// The sync-first line is not decoration: the push path has no merge rule, so a phone with an
// unsynced edit to one of these workouts would push the old weights back over the converted ones.
export function applyConfirmMessage(sessions: number, exercises: string[], beforeDate: string): string {
  return `Convert ${sessions} session(s) for ${exercises.join(', ')} logged before ${beforeDate} from lbs to kg? This cannot be undone automatically. Sync your phone first (More → Data → Sync now). An unsynced edit to one of these workouts would put the old weights back.`;
}
