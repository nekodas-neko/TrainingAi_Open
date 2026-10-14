import { AppButton, Card, Stack, StateCard } from '../../../shared/ui';
import { useWorkoutJournal } from '../logging/WorkoutJournalProvider';
import type { SessionPreview } from '../catalog';
import { WorkoutSaveNotice } from './WorkoutSaveNotice';
import { useTheme } from '../../../shared/theme/ThemeProvider';
import type { SessionStartOptions } from '../logging/session-options';

export function StartWorkoutCard({
  session,
  programId,
  openWorkout,
  inline = false,
  completed = false,
  onPrepare,
  launchExerciseId,
  actionLabel,
  options,
  disabled = false,
}: {
  session: SessionPreview;
  programId: string;
  openWorkout: (id: string) => void;
  inline?: boolean;
  completed?: boolean;
  onPrepare?: () => void;
  launchExerciseId?: string;
  actionLabel?: string;
  options?: SessionStartOptions;
  disabled?: boolean;
}) {
  const journal = useWorkoutJournal();
  const { theme } = useTheme();
  const active = journal.data.workouts.find((workout) => workout.status === 'active');
  async function start(useSaved = false) {
    const id = await journal.controller?.start(session, programId, useSaved, options);
    if (id) {
      if (launchExerciseId) {
        if (!(await journal.controller?.chooseExercise(id, launchExerciseId, true))) {
          return;
        }
      }
      openWorkout(id);
    }
  }
  if (!journal.ready) {
    return (
      <StateCard
        title="Saved workouts"
        message={journal.message ?? 'Opening your saved workout progress…'}
        loading={journal.busy}
        action={journal.busy ? undefined : 'Retry loading'}
        onAction={() => {
          void journal.controller?.initialize();
        }}
      />
    );
  }
  const Wrapper = inline ? Stack : Card;
  return (
    <>
      <Wrapper>
        <AppButton
          title={
            active
              ? active.sessionId === session.id
                ? 'Resume workout'
                : `Resume ${active.sessionName}`
              : completed
                ? 'Start Again'
                : (actionLabel ?? 'Start Workout')
          }
          variant={completed && !active ? 'surface' : 'primary'}
          style={
            completed && !active
              ? { borderWidth: 1, borderColor: theme.anatomy.main }
              : undefined
          }
          busy={journal.busy}
          disabled={disabled || (!active && session.exercises.length === 0)}
          onPress={() => {
            if (active) {
              openWorkout(active.id);
            } else if (onPrepare) {
              onPrepare();
            } else {
              void start();
            }
          }}
        />
        {!active && journal.savedFallbackFor === session.id && (
          <AppButton
            title="Start with saved session"
            variant="secondary"
            busy={journal.busy}
            onPress={() => {
              void start(true);
            }}
          />
        )}
      </Wrapper>
      <WorkoutSaveNotice />
    </>
  );
}
