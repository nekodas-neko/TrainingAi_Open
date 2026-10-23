import { useEffect, useRef } from 'react';
import { homeWidgets } from '../../integrations/widgets/platform';
import { useWorkoutContext } from '../workouts/WorkoutProvider';
import type { ScoreChipModel } from '../home/data/score-chips';
import { snapshotIdentity, todayWidgetSnapshot } from './snapshot';

/** Writes Home's scores for the Today widget whenever they change. Null while nothing is loaded. */
export function useTodayWidgetSnapshot(date: string, chips: readonly ScoreChipModel[] | null) {
  const { timezone } = useWorkoutContext();
  const last = useRef<string | null>(null);
  const snapshot = chips && todayWidgetSnapshot(date, chips, new Date(), timezone);
  const identity = snapshot && snapshotIdentity(snapshot);
  useEffect(() => {
    if (!homeWidgets || !snapshot || identity === last.current) return;
    last.current = identity;
    try {
      homeWidgets.setSnapshot(JSON.stringify(snapshot));
    } catch {
      // A widget that misses one update still shows the last snapshot, dated.
    }
    // `identity` covers every field of `snapshot` that matters.
  }, [identity]);
}
