import { getRepository } from '@/lib/data'
import type { ExerciseLibraryEntry } from '@trainingai/shared/types/program'

// In-process cache for the exercise library's name+muscles projection, used by
// muscle-recovery (computeMuscleRecovery only ever reads .name/.muscles — no
// reason to hydrate equipment/instructions/exerciseType on every request). The
// library is global and near-static, so a modest TTL is safe; admin exercise
// edits explicitly invalidate it rather than waiting it out.
const TTL_MS = 5 * 60 * 1000

let cached: { data: Pick<ExerciseLibraryEntry, 'name' | 'muscles'>[]; expiresAt: number } | null = null

export async function getExerciseMuscleMap(): Promise<Pick<ExerciseLibraryEntry, 'name' | 'muscles'>[]> {
  if (cached && cached.expiresAt > Date.now()) return cached.data
  const repo = await getRepository()
  const data = await repo.listExerciseMuscleMap()
  cached = { data, expiresAt: Date.now() + TTL_MS }
  return data
}

export function invalidateExerciseMuscleMap(): void {
  cached = null
}
