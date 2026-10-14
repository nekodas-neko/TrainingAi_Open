import { useRef, useState } from 'react';
import { AppButton, AppText, IconButton, Sheet, Stack } from '../../../shared/ui';
import type { WorkoutRecord } from '../logging/workout';
import { useWorkoutJournal } from '../logging/WorkoutJournalProvider';
import { WorkoutLayout } from './WorkoutLayout';
import { SessionExerciseList } from './SessionExerciseList';
import { ExercisePreviewCard } from './ExercisePreviewCard';
import { WorkoutSaveNotice } from './WorkoutSaveNotice';

export function WorkoutSessionHub({
  workout,
  onLeave,
  onFinish,
  onOptions,
  onMinimize,
  onMuscles,
}: {
  workout: WorkoutRecord;
  onLeave: () => void;
  onFinish: () => void;
  onOptions: () => void;
  onMinimize: () => void;
  onMuscles: () => void;
}) {
  const journal = useWorkoutJournal();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const pendingSelection = useRef<{ id: string; redo: boolean } | null>(null);
  function selectExercise(id: string, redo = false) {
    if (pendingSelection.current) {
      return;
    }
    pendingSelection.current = { id, redo };
    setSelectedId(null);
  }
  const exercises = workout.exercises
    .filter((exercise) => !exercise.retired && !exercise.relogOf)
    .map((exercise) => ({
      ...exercise,
      setCount: exercise.sets.length,
      sets: exercise.sets.flatMap((set) => (set.planned ? [set.planned] : [])),
    }));
  const selected = exercises.find((exercise) => exercise.id === selectedId);
  const allDone = workout.exercises.every(
    (exercise) =>
      exercise.retired ||
      exercise.relogOf ||
      exercise.skipped ||
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
      titleAction={
        <IconButton icon="muscles" label="Muscles worked" onPress={onMuscles} />
      }
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
      <WorkoutSaveNotice />
      <AppText variant="eyebrow" tone="muted">
        Today&apos;s exercises
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
        onDismiss={() => {
          const selection = pendingSelection.current;
          pendingSelection.current = null;
          if (!selection) {
            return;
          }
          void (
            selection.redo
              ? journal.controller?.redoExercise(workout.id, selection.id)
              : journal.controller?.chooseExercise(workout.id, selection.id, true)
          )?.then((saved) => {
            if (!saved) {
              setSelectedId(selection.id);
            }
          });
        }}
      >
        {selected && (
          <>
            <ExercisePreviewCard
              exercise={selected}
              position={exercises.indexOf(selected) + 1}
            />
            <AppButton
              title={
                workout.exercises
                  .find((exercise) => exercise.id === selected.id)
                  ?.sets.every((set) => set.completedAt !== null)
                  ? 'View set summary'
                  : 'Start Exercise'
              }
              disabled={
                !!workout.runningSet && workout.runningSet.exerciseId !== selected.id
              }
              onPress={() => {
                selectExercise(selected.id);
              }}
            />
            {doneIds.includes(selected.id) && (
              <AppButton
                title="Re-log this exercise"
                busy={journal.busy}
                onPress={() => {
                  selectExercise(selected.id, true);
                }}
              />
            )}
          </>
        )}
      </Sheet>
    </WorkoutLayout>
  );
}
