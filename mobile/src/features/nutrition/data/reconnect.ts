import { onReconnect } from '../../../core/sync/resume';
import type { NutritionStore } from './NutritionStore';

/** The kinds a day screen reads. */
export const dayKinds = [
  'mealTypes',
  'foods',
  'meals',
  'supplements',
  'targets',
  'logs',
  'answers',
  'checkin',
  'mealStatuses',
] as const;

/**
 * #3913: a day that failed offline reloads once the connection is back. Not a manual refresh, so a
 * kind that is still fresh stays put and only a voided backoff sends anything.
 */
export function reloadDayOnReconnect(store: Pick<NutritionStore, 'refresh'> | null, today: string) {
  return onReconnect(() => {
    for (const kind of dayKinds) void store?.refresh(kind, today);
  });
}
