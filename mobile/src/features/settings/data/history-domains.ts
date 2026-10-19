import { shiftDateStr } from '@trainingai/shared/date-utils';
import type { HistoryDomain, HistoryPlan } from '../../../core/sync/HistoryDownload.ts';
import { activityHistorySpec, progressSpec, weightsSpec } from '../../health/data/models.ts';
import type { NutritionStore } from '../../nutrition/data/NutritionStore.ts';
import {
  calendarSpec,
  daySpec,
  recordsSpec,
  strengthSpec,
  streakDataSpec,
} from '../../workouts/data/models.ts';
import type { ResourceSpec, WorkoutResources } from '../../workouts/data/WorkoutResources.ts';

export const HISTORY_DOWNLOAD_DAYS = [30, 90, 365] as const;
// Food logs and evening check-ins live in one saved nutrition record that is rewritten on every
// nutrition change, so they stop at 90 days to keep each of those writes small.
export const NUTRITION_HISTORY_DAYS = 90;

const summaries: Record<string, ResourceSpec<unknown>> = {
  streak: streakDataSpec,
  strength: strengthSpec,
  records: recordsSpec,
  weights: weightsSpec,
  progress: progressSpec,
  activities: activityHistorySpec,
};

// Each domain fills the same saved view its screen reads, keyed by date or month, so an offline
// screen opens straight onto what was downloaded and every pending change still overlays it.
export function historyDomains(
  plan: HistoryPlan,
  targets: {
    resources: Pick<WorkoutResources, 'download'>;
    nutrition: Pick<NutritionStore, 'refresh'> | null;
  },
): HistoryDomain[] {
  const days = Array.from({ length: plan.days }, (_, index) => shiftDateStr(plan.anchor, -index));
  const recent = days.slice(0, NUTRITION_HISTORY_DAYS);
  const months = [...new Set(days.map((day) => day.slice(0, 7)))];
  const nutrition = (kind: 'logs' | 'checkin') => async (date: string) => {
    if ((await targets.nutrition?.refresh(kind, date, true)) !== true) {
      throw new Error('Nutrition history was not saved.');
    }
  };
  return [
    {
      id: 'days',
      label: 'Workouts, activities, sleep and body',
      keys: days,
      fetch: (date) => targets.resources.download(daySpec(date)),
    },
    {
      id: 'calendar',
      label: 'Training calendar',
      keys: months,
      fetch: (month) =>
        targets.resources.download(calendarSpec(Number(month.slice(0, 4)), Number(month.slice(5)))),
    },
    ...(targets.nutrition
      ? [
          {
            id: 'food',
            label: 'Food logs',
            keys: recent,
            fetch: nutrition('logs'),
          },
          {
            id: 'checkins',
            label: 'Evening check-ins',
            keys: recent,
            fetch: nutrition('checkin'),
          },
        ]
      : []),
    {
      id: 'summaries',
      label: 'Trends and records',
      keys: Object.keys(summaries),
      fetch: (name) => targets.resources.download(summaries[name]),
    },
  ];
}
