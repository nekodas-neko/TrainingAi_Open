import { useEffect, useMemo, useRef } from 'react';
import { AppState } from 'react-native';
import { reportError } from '../../../core/reporting/index.ts';
import {
  alertPermission,
  alertPermissionAskable,
} from '../../../integrations/notifications/platform';
import { workoutStatus } from '../../../integrations/workout-status/platform';
import { useAccountContext } from '../../account/AccountProvider';
import { useWorkoutJournal } from '../logging/WorkoutJournalProvider';
import {
  accountScopeDecision,
  routeOpen,
  shouldAskPermission,
  startingScope,
} from './sync-decisions';
import {
  clearWorkoutStatus,
  createWorkoutStatusReporter,
  promotionDiagnostic,
} from './workout-status';

// A burst of journal writes (a set logged, its rest started) becomes one update.
const DEBOUNCE_MS = 250;
// How long after the app's first post to read back what the system did with it.
const PROMOTION_CHECK_MS = 2_000;
let promotionReported = false;

/**
 * Clears the notification when the account goes: signed out, or a different one. It sits above
 * the screens that remount on a change of account, so it sees the change they cannot. A token
 * refresh (no reader, still signed in) leaves a live workout's notification alone.
 */
export function WorkoutStatusAccountGuard() {
  const { state, dataReader } = useAccountContext();
  const userId = dataReader?.userId ?? null;
  const scope = useRef(startingScope);
  useEffect(() => {
    const decision = accountScopeDecision(scope.current, state.status, userId);
    scope.current = decision.scope;
    if (decision.clear) clearWorkoutStatus(workoutStatus);
  }, [state.status, userId]);
  return null;
}

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

  // The first update after the journal loads is the reconcile and goes at once; later ones wait
  // for the burst to settle.
  const reconciled = useRef(false);
  useEffect(() => {
    if (!journal.ready) return;
    const timer = setTimeout(
      () => {
        reconciled.current = true;
        reporter.update(active);
        if (active) checkPromotionOnce();
      },
      reconciled.current ? DEBOUNCE_MS : 0,
    );
    return () => clearTimeout(timer);
  }, [journal.ready, active, reporter]);

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
    if (!workoutStatus || !activeId) return;
    let live = true;
    void (async () => {
      const ask = shouldAskPermission({
        moduleAvailable: true,
        startedHere: activeId !== baseline.current?.id,
        alreadyAsked: asked.current === activeId,
        canAskAgain: await alertPermissionAskable(),
      });
      if (!ask || !live) return;
      asked.current = activeId;
      if (await alertPermission(true)) {
        reporter.invalidate();
        reporter.update(latest.current);
      }
    })().catch(() => {});
    return () => {
      live = false;
    };
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
    if (routeOpen(latest.current?.id ?? null, workoutId) === 'workout')
      open.current.onWorkout(workoutId);
    else open.current.onWorkoutTab();
  }
  useEffect(() => {
    let subscription: { remove(): void } | undefined;
    try {
      subscription = workoutStatus?.addListener('onOpen', (event) => {
        if (journal.ready) route(event.workoutId);
        else pending.current = event.workoutId;
      });
    } catch {}
    return () => subscription?.remove();
  }, [journal.ready]);
  useEffect(() => {
    if (!journal.ready) return;
    let taken: string | null = null;
    try {
      taken = workoutStatus?.takeOpenRequest() ?? null;
    } catch {}
    const workoutId = pending.current ?? taken;
    pending.current = null;
    if (workoutId) route(workoutId);
  }, [journal.ready]);
  return null;
}

/** Once per app start, shortly after the first post, reports what the system did with it. */
function checkPromotionOnce() {
  if (promotionReported || !workoutStatus) return;
  promotionReported = true;
  setTimeout(() => {
    try {
      const report = workoutStatus?.promotion();
      if (report) reportError(new Error(promotionDiagnostic(report)));
    } catch {}
  }, PROMOTION_CHECK_MS);
}
