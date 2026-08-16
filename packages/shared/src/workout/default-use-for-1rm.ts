// The default useFor1rm gate when a set's own progression style doesn't specify
// one (One Formula, One Place). Split into its own dependency-free leaf module so
// client-bundled code (lib/local-store/sqlite-backend.ts) can import it without
// pulling in lib/workout/log-exercise.ts's server-only dependency chain (@/lib/data -> pg).
export function defaultUseFor1rm(reps: number[], i: number): boolean {
  const allRepsEqual = reps.every(r => r === reps[0]);
  const minReps = Math.min(...reps);
  const r = reps[i] ?? reps[reps.length - 1];
  return allRepsEqual ? true : r === minReps;
}
