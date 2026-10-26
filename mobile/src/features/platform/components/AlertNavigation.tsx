import { useEffect, useRef } from 'react';
import { todayInTz, weekStartForDay, shiftDateStr } from '@trainingai/shared/date-utils';
import { usePlatformIntegrations } from '../PlatformProvider';
import { useWorkoutJournal } from '../../workouts/logging/WorkoutJournalProvider';
import { useActivities } from '../../activities/data/ActivityProvider';
import { useAccountContext } from '../../account/AccountProvider';
import type { Tab } from '../../../app/navigation/tabs';
import { estimateActionFrom, type EstimateAction } from '../../meal-plans/data/estimated-meals';
export function AlertNavigation({
  onWorkout,
  onWalk,
  onTab,
  onReview,
  onWeek,
  onMealEstimate,
}: {
  onWorkout: (id: string) => void;
  onWalk: () => void;
  onTab: (tab: Tab) => void;
  onReview: () => void;
  onWeek: (week: string) => void;
  /** A meal reminder's action, or a tap on it, for one plan meal (#2123). */
  onMealEstimate: (request: {
    id: string;
    planMealId: string;
    date: string;
    action: EstimateAction;
  }) => void;
}) {
  const { opened, state } = usePlatformIntegrations();
  const journal = useWorkoutJournal(),
    activity = useActivities(),
    account = useAccountContext();
  const handled = useRef<unknown>(null);
  useEffect(() => {
    if (
      !opened ||
      !state?.ready ||
      opened.scope !== state.settings.scope ||
      handled.current === opened.responseId
    )
      return;
    if (
      (opened.target === 'workout' && opened.recordId && !journal.ready) ||
      (opened.target === 'walk' && !activity.ready)
    )
      return;
    handled.current = opened.responseId;
    if (opened.target === 'workout') {
      const record = journal.data.workouts.find((row) => row.id === opened.recordId);
      if (record) onWorkout(record.id);
      else onTab('Workout');
    } else if (opened.target === 'walk') {
      if (activity.session?.id === opened.recordId) onWalk();
      else onTab('Workout');
    } else if (opened.target === 'nutrition') {
      const meal = opened.mealEstimate as { planMealId?: unknown; date?: unknown } | null;
      if (typeof meal?.planMealId === 'string' && typeof meal.date === 'string') {
        onMealEstimate({
          id: String(opened.responseId),
          planMealId: meal.planMealId,
          date: meal.date,
          action: estimateActionFrom(opened.actionIdentifier),
        });
      }
      onTab('Nutrition');
    }
    else if (opened.target === 'review') onReview();
    else if (opened.target === 'week') {
      const today = todayInTz(
        account.dataReader?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
      );
      onWeek(shiftDateStr(weekStartForDay(today), -7));
    } else if (opened.target === 'health') onTab('Health');
  }, [
    opened,
    state,
    journal.ready,
    journal.data.workouts,
    activity.ready,
    activity.session,
    account.dataReader,
    onWorkout,
    onWalk,
    onTab,
    onReview,
    onWeek,
    onMealEstimate,
  ]);
  return null;
}
