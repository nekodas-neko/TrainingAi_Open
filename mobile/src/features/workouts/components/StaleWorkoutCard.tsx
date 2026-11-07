import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { formatDateDisplay } from '@trainingai/shared/date-utils';
import { AppButton, AppText, Card, ConfirmationCard, Stack } from '../../../shared/ui';
import { useWorkoutJournal } from '../logging/WorkoutJournalProvider';
import {
  isStaleWorkout,
  lastActivityAt,
  recordedSets,
  STALE_WORKOUT_MS,
  type WorkoutRecord,
} from '../logging/workout';

/**
 * Whether the active workout has gone stale (#3664). Checked when the workout changes, when the app
 * returns to the foreground, and once at the moment it would cross the line, so the screens that
 * read it do not re-render every second to find out.
 */
export function useStaleWorkout(workout: WorkoutRecord | undefined): boolean {
  const [now, setNow] = useState(Date.now);
  const due = workout?.status === 'active' ? lastActivityAt(workout) + STALE_WORKOUT_MS : null;
  useEffect(() => {
    setNow(Date.now());
    const listener = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        setNow(Date.now());
      }
    });
    const wait = due === null ? null : due - Date.now() + 1;
    const timer =
      wait !== null && wait > 0 && wait < 2 ** 31 - 1
        ? setTimeout(() => setNow(Date.now()), wait)
        : null;
    return () => {
      listener.remove();
      if (timer) {
        clearTimeout(timer);
      }
    };
  }, [due]);
  return workout !== undefined && isStaleWorkout(workout, now);
}

/**
 * #3664: an unfinished workout left for over four hours. It is offered to save, as it stood at its
 * last recorded set, or to discard; never resumed into today, where its sets would upload under
 * its old date. A workout with nothing recorded can only be discarded, which loses nothing.
 */
export function StaleWorkoutCard({
  workout,
  onResolved,
}: {
  workout: WorkoutRecord;
  onResolved?: (outcome: 'saved' | 'discarded') => void;
}) {
  const journal = useWorkoutJournal();
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const count = recordedSets(workout).length;
  const when = formatDateDisplay(workout.date, 'long');
  async function save() {
    if (await journal.controller?.finishStale(workout.id)) {
      onResolved?.('saved');
    }
  }
  async function discard() {
    if (await journal.controller?.discard(workout.id)) {
      onResolved?.('discarded');
    }
  }
  if (confirmDiscard) {
    return (
      <ConfirmationCard
        title="Discard this workout?"
        message={
          count
            ? `Its ${count} recorded ${count === 1 ? 'set' : 'sets'} will not upload.`
            : 'Nothing was recorded in it.'
        }
        confirmLabel="Discard workout"
        cancelLabel="Back"
        danger
        busy={journal.busy}
        onConfirm={() => {
          void discard();
        }}
        onCancel={() => setConfirmDiscard(false)}
      />
    );
  }
  return (
    <Card accessibilityRole="alert">
      <AppText variant="heading">Unfinished {workout.sessionName}</AppText>
      <AppText tone="muted">
        {count
          ? `Started ${when} and never finished. Save its ${count} recorded ${count === 1 ? 'set' : 'sets'} to that day, or discard it.`
          : `Started ${when} with nothing recorded.`}
      </AppText>
      <Stack>
        {count > 0 && (
          <AppButton
            title="Save to that day"
            busy={journal.busy}
            onPress={() => {
              void save();
            }}
          />
        )}
        <AppButton
          title="Discard workout"
          variant="secondary"
          disabled={journal.busy}
          onPress={() => setConfirmDiscard(true)}
        />
      </Stack>
    </Card>
  );
}
