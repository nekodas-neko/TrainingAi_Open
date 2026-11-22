import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { useUndo } from '../../../shared/ui/undo/UndoProvider';
import { connectivity } from '../../../core/sync/Connectivity';
import { useHealthData } from '../../health/data/HealthDataProvider';
import { useWorkoutContext } from '../../workouts/WorkoutProvider';
import { useWorkoutResource } from '../../workouts/data/WorkoutDataProvider';
import { useHome } from '../data/HomeProvider';
import {
  cardView,
  defaultAnswers,
  laterKey,
  saveBody,
  weeklyCheckinSpec,
  type CheckinAnswers,
  type OfferAction,
  type SaveNotes,
  type UndoTarget,
} from '../data/weekly-checkin';
import { WeeklyCheckinActions, type CheckinResult } from '../data/weekly-checkin-actions';
import { WeeklyCheckinCard } from './WeeklyCheckinCard';
import { WeeklyCheckinSheet } from './WeeklyCheckinSheet';

/**
 * #3890 step 3: the weekly check-in's card and its sheet. The state is the GET's, cached for the
 * day, so a repeat visit paints the card at once and revalidates behind it. "Later" is a marker on
 * this phone for today only, not the server's dismiss: the server's closes the week for good, while
 * "Later" should bring the card back tomorrow if its window is still open.
 */
export function WeeklyCheckin() {
  const health = useHealthData();
  const home = useHome();
  const undo = useUndo();
  const workout = useWorkoutContext();
  const spec = useMemo(() => weeklyCheckinSpec(health.today), [health.today]);
  const resource = useWorkoutResource(spec);
  const { resources } = resource;
  const state = resource.data;
  const offline = useSyncExternalStore(
    connectivity.subscribe,
    () => connectivity.isOffline(),
    () => false,
  );
  const actions = useMemo(
    () =>
      resources
        ? new WeeklyCheckinActions(resources, spec, workout.invalidate, () => connectivity.isOffline())
        : null,
    [resources, spec, workout.invalidate],
  );
  const [open, setOpen] = useState(false);
  const [answers, setAnswers] = useState<CheckinAnswers | null>(null);
  const [notes, setNotes] = useState<SaveNotes | null>(null);
  const [sending, setSending] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const weekStart = state?.weekStart ?? null;
  // A new week under review starts from the defaults again.
  useEffect(() => {
    setAnswers(null);
    setNotes(null);
  }, [weekStart]);
  const view = cardView(state, home.markers, health.today);
  // The sheet stays up after a refusal that closes the card, so its message is still read.
  if (!state || !weekStart || (!view && !open)) {
    return null;
  }
  const current = answers ?? defaultAnswers(state);
  async function send(key: string, call: () => Promise<CheckinResult>) {
    setSending(key);
    setMessage(null);
    try {
      const result = await call();
      if (result.ok) {
        if (result.notes) setNotes(result.notes);
      } else if (result.message) {
        setMessage(result.message);
      }
    } finally {
      setSending(null);
    }
  }
  const later = () => {
    const store = home.store;
    if (!store) return;
    const key = laterKey(weekStart, health.today);
    void undo.perform({
      key,
      label: 'Weekly check-in moved to tomorrow',
      apply: () => store.mark(key),
      revert: () => store.mark(key, false),
    });
  };
  return (
    <>
      <WeeklyCheckinCard
        view={view}
        onStart={() => setOpen(true)}
        onLater={later}
        onSee={() => setOpen(true)}
      />
      {open && (
        <WeeklyCheckinSheet
          state={state}
          answers={current}
          onAnswers={setAnswers}
          notes={notes}
          offline={offline}
          sending={sending}
          message={message}
          onSave={() => {
            if (!actions) return;
            void send('save', () => actions.save(saveBody(weekStart, state, current)));
          }}
          onOffer={(row: string, offer: OfferAction, decision: 'accept' | 'decline') => {
            const id = state.checkin?.id;
            if (!actions || !id) return;
            void send(row, () => actions.offer(id, offer, decision));
          }}
          onUndo={(row: string, target: UndoTarget) => {
            const id = state.checkin?.id;
            if (!actions || !id) return;
            void send(row, () => actions.undo(id, target));
          }}
          onClose={() => {
            setOpen(false);
            setMessage(null);
          }}
        />
      )}
    </>
  );
}
