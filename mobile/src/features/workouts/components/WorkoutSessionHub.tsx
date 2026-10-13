import { useState } from 'react';
import { AppButton, AppText, IconButton, Sheet, Stack } from '../../../shared/ui';
import type { WorkoutRecord } from '../logging/workout';
import { useWorkoutJournal } from '../logging/WorkoutJournalProvider';
import { WorkoutLayout } from './WorkoutLayout';
import { SessionExerciseList } from './SessionExerciseList';
import { ExercisePreviewCard } from './ExercisePreviewCard';

export function WorkoutSessionHub({
  workout,
  onLeave,
  onFinish,
  onOptions,
  onMinimize,
}: {
  workout: WorkoutRecord;
  onLeave: () => void;
  onFinish: () => void;
  onOptions: () => void;
  onMinimize: () => void;
}) {
  const journal = useWorkoutJournal();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const exercises = workout.exercises
    .filter((exercise) => !exercise.retired && !exercise.relogOf)
    .map((exercise) => ({
      ...exercise,
      setCount: exercise.sets.length,
      sets: exercise.sets.flatMap((set) => (set.planned ? [set.planned] : [])),
    }));
  const selected = exercises.find((exercise) => exercise.id === selectedId);
  const allDone = workout.exercises.every((exercise) =>
    exercise.sets.every((set) => set.completedAt !== null),
  );
  const doneIds = workout.exercises
    .filter((exercise) => exercise.sets.every((set) => set.completedAt !== null))
    .map((exercise) => exercise.id);
  return (
    <WorkoutLayout
      title={workout.sessionName}
      subtitle={new Intl.DateTimeFormat('en-AU', {
        timeZone: workout.timezone,
        weekday: 'long',
        day: 'numeric',
        month: 'long',
      }).format(new Date())}
      detail={workout.phaseDetail ?? workout.phase ?? undefined}
      onBack={onLeave}
      backLabel="Back to sessions"
      workout={workout}
      actions={
        <Stack direction="row" gap="xs">
          <IconButton icon="down" label="Minimize workout" onPress={onMinimize} />
          <IconButton icon="more" label="Workout options" onPress={onOptions} />
        </Stack>
      }
      footer={
        <AppButton
          title={allDone ? 'Complete Workout' : 'Continue Workout'}
          busy={journal.busy}
          onPress={() => {
            if (allDone) {
              onFinish();
            } else {
              void journal.controller?.continueSession(workout.id);
            }
          }}
        />
      }
    >
      <AppText variant="eyebrow" tone="muted">
        Today's exercises
      </AppText>
      <SessionExerciseList
        exercises={exercises}
        completedIds={doneIds}
        onSelect={(exercise) => setSelectedId(exercise.id)}
      />
      <Sheet
        visible={!!selected}
        title={selected?.name ?? 'Exercise'}
        onClose={() => setSelectedId(null)}
      >
        {selected && (
          <>
            <ExercisePreviewCard exercise={selected} position={exercises.indexOf(selected) + 1} />
            <AppButton
              title={
                workout.exercises
                  .find((exercise) => exercise.id === selected.id)
                  ?.sets.every((set) => set.completedAt !== null)
                  ? 'View set summary'
                  : 'Start Exercise'
              }
              disabled={!!workout.runningSet && workout.runningSet.exerciseId !== selected.id}
              onPress={() => {
                void journal.controller?.chooseExercise(workout.id, selected.id, true);
                setSelectedId(null);
              }}
            />
            {doneIds.includes(selected.id) && (
              <AppButton
                title="Re-log this exercise"
                busy={journal.busy}
                onPress={() => {
                  void journal.controller?.redoExercise(workout.id, selected.id);
                  setSelectedId(null);
                }}
              />
            )}
          </>
        )}
      </Sheet>
    </WorkoutLayout>
  );
}
