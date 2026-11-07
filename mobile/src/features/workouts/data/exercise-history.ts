import { isEstimatedOneRm } from '@trainingai/shared/1rm';

/**
 * The entries an exercise's 1RM trend plots, oldest first. A deload log stores a 1RM of 0 (it is
 * not estimated at all), so it is left off, as the current app's exercise sheet does (#3666).
 */
export function oneRmTrendEntries<T extends { estimated1rm: number | null }>(
  entries: readonly T[],
): (T & { estimated1rm: number })[] {
  return entries
    .filter((entry): entry is T & { estimated1rm: number } => isEstimatedOneRm(entry.estimated1rm))
    .slice()
    .reverse();
}
