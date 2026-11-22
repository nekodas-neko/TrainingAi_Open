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
  LATER_PREFIX,
  liftsChangedMessage,
  laterKey,
  liftOf,
  reconcileAnswers,
  prepareSave,
  withoutNotesFor,
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
 * this phone for today only, not the server's dismiss: the server's dismiss also only hides the card
 * (a save after it is still allowed), while "Later" brings the card back tomorrow if its window is
 * still open.
 */
const emptyAnswers: CheckinAnswers = {
  lifts: {},
  pain: 'no',
  painLift: null,
  painWhere: '',
  swap: 'no',
  swapLift: null,
  daysOff: [],
  length: 'usual',
};

export function WeeklyCheckin() {
  const health = useHealthData();
  const home = useHome();
  const undo = useUndo();
  const workout = useWorkoutContext();
  const spec = useMemo(() => weeklyCheckinSpec(), []);
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
  // The save went through but its reply could not be read: shown apart from `message`, which is an error.
  const [notice, setNotice] = useState<string | null>(null);
  const weekStart = state?.weekStart ?? null;
  // A new week under review starts from the defaults again.
  useEffect(() => {
    setAnswers(null);
    setNotes(null);
  }, [weekStart]);
  // After a reload the lifts may differ: drop what belongs to a lift that is gone, and say so once.
  const liftIds = state?.lifts.map((l) => l.sessionExerciseId).join(',') ?? '';
  useEffect(() => {
    if (!answers || !state) return;
    const next = reconcileAnswers(answers, state);
    if (next.reset) {
      setAnswers(next.answers);
      // Only while the sheet is open: a message set behind a closed sheet would show on the next open.
      const told = liftsChangedMessage(next.reset, open);
      if (told) setMessage(told);
    }
    // Only a change of lifts matters here, not every keystroke in the answers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liftIds]);
  const view = cardView(state, home.markers, health.today);
  // The sheet stays up after a refusal that closes the card, so its message is still read.
  if (!view && !open) {
    return null;
  }
  const current = answers ?? (state ? defaultAnswers(state) : null);
  async function send(
    key: string,
    call: () => Promise<CheckinResult>,
    touchedLift: string | null = null,
  ) {
    setSending(key);
    setMessage(null);
    setNotice(null);
    try {
      const result = await call();
      if (result.ok) {
        if (result.notes) setNotes(result.notes);
        // The row changed: the reason shown under it belonged to what it was before.
        else if (touchedLift) setNotes((n) => withoutNotesFor(n, touchedLift));
        if (result.notice) setNotice(result.notice);
      } else if (result.message) {
        setMessage(result.message);
      }
    } finally {
      setSending(null);
    }
  }
  // A message from before the sheet was last closed never shows when it opens again.
  const openSheet = () => {
    setMessage(null);
    setNotice(null);
    setOpen(true);
  };
  const later = () => {
    const store = home.store;
    if (!store || !weekStart) return;
    const key = laterKey(weekStart, health.today);
    // One marker at a time: writing today's removes the earlier days' and weeks'.
    void undo.perform({
      key,
      label: 'Weekly check-in moved to tomorrow',
      apply: () => store.markOnly(LATER_PREFIX, key),
      revert: () => store.markOnly(LATER_PREFIX, key, false),
    });
  };
  return (
    <>
      <WeeklyCheckinCard
        view={view}
        onStart={openSheet}
        onLater={later}
        onSee={openSheet}
      />
      {open && (
        <WeeklyCheckinSheet
          state={state}
          answers={current ?? emptyAnswers}
          onAnswers={setAnswers}
          notes={notes}
          offline={offline}
          sending={sending}
          message={message}
          notice={notice}
          onSave={() => {
            if (!actions || !state || !weekStart || !current) return;
            const prepared = prepareSave(weekStart, state, current);
            if (!prepared.send) {
              setAnswers(prepared.answers);
              setNotice(null);
              setMessage(prepared.message);
              return;
            }
            void send('save', () => actions.save(prepared.body));
          }}
          onOffer={(row: string, offer: OfferAction, decision: 'accept' | 'decline') => {
            const id = state?.checkin?.id;
            if (!actions || !id) return;
            void send(row, () => actions.offer(id, offer, decision), liftOf(state?.checkin ?? null, offer));
          }}
          onUndo={(row: string, target: UndoTarget) => {
            const id = state?.checkin?.id;
            if (!actions || !id) return;
            void send(row, () => actions.undo(id, target), liftOf(state?.checkin ?? null, target));
          }}
          onClose={() => {
            setOpen(false);
            setMessage(null);
            setNotice(null);
          }}
        />
      )}
    </>
  );
}
