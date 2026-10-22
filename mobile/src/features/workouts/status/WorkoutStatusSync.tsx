import { useEffect, useMemo, useRef } from 'react';
import { AppState } from 'react-native';
import { alertPermission } from '../../../integrations/notifications/platform';
import { workoutStatus } from '../../../integrations/workout-status/platform';
import { useWorkoutJournal } from '../logging/WorkoutJournalProvider';
import { createWorkoutStatusReporter } from './workout-status';

/**
 * Drives the Android workout notification from the journal (#3249). It renders nothing: it shows,
 * updates and clears the notification as the active workout changes, reconciles it when the app
 * starts after a process kill, and routes a tap on it to the workout it names.
 */
export function WorkoutStatusSync({
  onWorkout,
  onWorkoutTab,
}: {
  onWorkout: (id: string) => void;
  onWorkoutTab: () => void;
}) {
  const journal = useWorkoutJournal();
  const reporter = useMemo(() => createWorkoutStatusReporter(workoutStatus), []);
  const active = journal.ready
    ? (journal.data.workouts.find((workout) => workout.status === 'active') ?? null)
    : null;
  const activeId = active?.id ?? null;
  const latest = useRef(active);
  latest.current = active;

  useEffect(() => {
    if (journal.ready) reporter.update(active);
  }, [journal.ready, active, reporter]);

  // Signing out or switching account drops the controller; the old account's workout must not
  // stay on the lock screen. Before the first controller exists there is nothing to drop.
  const hadController = useRef(false);
  useEffect(() => {
    if (journal.controller) hadController.current = true;
    else if (hadController.current) {
      hadController.current = false;
      reporter.clear();
    }
  }, [journal.controller, reporter]);

  // The permission is asked when a workout is started in this session, never at launch: a workout
  // already open when the app starts was reconciled above without asking.
  const baseline = useRef<{ id: string | null } | null>(null);
  const asked = useRef<string | null>(null);
  useEffect(() => {
    if (!journal.ready) return;
    if (!baseline.current) {
      baseline.current = { id: activeId };
      return;
    }
    if (!activeId || activeId === baseline.current.id || activeId === asked.current) return;
    asked.current = activeId;
    void alertPermission(true)
      .then((allowed) => {
        if (!allowed) return;
        reporter.invalidate();
        reporter.update(latest.current);
      })
      .catch(() => {});
  }, [journal.ready, activeId, reporter]);

  // A permission or Live Updates switch changed in system settings takes effect on return.
  useEffect(() => {
    const listener = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      reporter.invalidate();
      if (journal.ready) reporter.update(latest.current);
    });
    return () => listener.remove();
  }, [journal.ready, reporter]);

  const pending = useRef<string | null>(null);
  const open = useRef({ onWorkout, onWorkoutTab });
  open.current = { onWorkout, onWorkoutTab };
  function route(workoutId: string) {
    if (workoutId === latest.current?.id) open.current.onWorkout(workoutId);
    else open.current.onWorkoutTab();
  }
  useEffect(() => {
    const subscription = workoutStatus?.addListener('onOpen', (event) => {
      if (journal.ready) route(event.workoutId);
      else pending.current = event.workoutId;
    });
    return () => subscription?.remove();
  }, [journal.ready]);
  useEffect(() => {
    if (!journal.ready) return;
    const workoutId = pending.current ?? workoutStatus?.takeOpenRequest() ?? null;
    pending.current = null;
    if (workoutId) route(workoutId);
  }, [journal.ready]);
  return null;
}
