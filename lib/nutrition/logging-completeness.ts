import type { WorkoutRepository } from '@/lib/data/repository';

export async function foodLoggingCoverage(
  repo: Pick<WorkoutRepository, 'listMealLoggingCompleteness'>,
  userId: string,
  from: string,
  to: string,
  legacyDates: string[],
) {
  const complete = new Set(legacyDates);
  const zeroIntake = new Set<string>();
  if (!repo.listMealLoggingCompleteness) return { complete, zeroIntake };
  try {
    for (const day of await repo.listMealLoggingCompleteness(userId, from, to)) {
      if (day.complete) complete.add(day.date);
      else if (day.explicit) complete.delete(day.date);
      if (day.complete && day.zeroIntake) zeroIntake.add(day.date);
    }
    return { complete, zeroIntake };
  } catch {
    return { complete: new Set(legacyDates), zeroIntake: new Set<string>() };
  }
}
