import { useRef, useState } from 'react';
import { activeInjuredMuscles } from '@trainingai/shared/workout/injury-context';
import { injurySafeAlternatives } from '@trainingai/shared/workout/injury-substitution';
import { normalizeMuscle } from '@trainingai/shared/muscles';
import { AppButton, AppText, Card, ListRow, Notice, Sheet } from '../../../shared/ui';
import { useWorkoutResource } from '../data/WorkoutDataProvider';
import {
  exerciseHistorySpec,
  injurySpec,
  librarySpec,
  type LibraryExercise,
} from '../data/models';
import { useWorkoutJournal } from '../logging/WorkoutJournalProvider';
import type { WorkoutExercise, WorkoutRecord } from '../logging/workout';
import { useWorkoutAction } from '../data/useWorkoutAction';

export function InjuryControls({
  workout,
  exercise,
  compact = false,
  onSkip,
}: {
  workout: WorkoutRecord;
  exercise: WorkoutExercise;
  compact?: boolean;
  onSkip: () => void;
}) {
  const injuries = useWorkoutResource(injurySpec);
  const library = useWorkoutResource(librarySpec);
  const journal = useWorkoutJournal();
  const action = useWorkoutAction();
  const [open, setOpen] = useState(false);
  const pendingSkip = useRef(false);
  const injured = new Set(activeInjuredMuscles(injuries.data ?? []).map(normalizeMuscle));
  const muscles = [
    ...new Set(
      [
        ...(exercise.mainMuscles.length ? exercise.mainMuscles : exercise.muscles),
        ...exercise.secondaryMuscles,
      ].map(normalizeMuscle),
    ),
  ].filter((muscle) => injured.has(muscle));
  const alternatives = injurySafeAlternatives(
    {
      name: exercise.name,
      mainMuscles: (exercise.mainMuscles.length
        ? exercise.mainMuscles
        : exercise.muscles
      ).map(normalizeMuscle),
    },
    [...injured],
    library.data?.exercises ?? [],
  );
  async function swap(alternative: LibraryExercise) {
    await action.run(async () => {
      let estimated1rm: number | null = null;
      let lastReps: number[] = [];
      let lastWeights: number[] = [];
      let lastDate: string | null = null;
      if (library.resources) {
        const spec = exerciseHistorySpec(alternative.name);
        await library.resources.load(spec);
        const history = library.resources.state(spec).data;
        const latest = history?.entries[0];
        if (latest) {
          estimated1rm = latest.estimated1rm;
          lastReps = latest.reps;
          lastWeights = latest.weightKg;
          lastDate = latest.date.split(' ')[0].replace(/\//g, '-');
        }
      }
      const saved = await journal.controller?.swapExercise(workout.id, exercise.id, {
        name: alternative.name,
        muscles: alternative.muscles.map((muscle) => muscle.muscle),
        mainMuscles: alternative.muscles
          .filter((muscle) => muscle.role === 'main')
          .map((muscle) => muscle.muscle),
        secondaryMuscles: alternative.muscles
          .filter((muscle) => muscle.role === 'secondary')
          .map((muscle) => muscle.muscle),
        equipment: alternative.equipment,
        instructions: alternative.instructions ?? null,
        exerciseType: alternative.exerciseType,
        estimated1rm,
        lastReps,
        lastWeights,
        lastDate,
      });
      if (!saved) {
        throw new Error(
          'Could not save the exercise swap. Your existing sets are unchanged.',
        );
      }
      setOpen(false);
    });
  }
  if (injuries.error && injuries.data === null) {
    return <Notice title="Injury warnings unavailable" message={injuries.error} />;
  }
  if (!muscles.length) {
    return null;
  }
  return (
    <>
      <Card tone="heart">
        <AppText variant={compact ? 'micro' : 'label'}>
          Injury: {muscles.join(', ')}
        </AppText>
        {!compact && (
          <AppText variant="caption" tone="muted">
            Recorded injury involves this exercise&apos;s muscles.
          </AppText>
        )}
        <AppButton
          title="Swap"
          variant="ghost"
          disabled={!!workout.runningSet}
          onPress={() => setOpen(true)}
        />
      </Card>
      <Sheet
        visible={open}
        title="Swap Exercise"
        onClose={() => setOpen(false)}
        onDismiss={() => {
          if (pendingSkip.current) {
            pendingSkip.current = false;
            onSkip();
          }
        }}
      >
        {action.error && <Notice title="Swap not saved" message={action.error} />}
        {library.error && <Notice title="Exercise library" message={library.error} />}
        {alternatives.length ? (
          alternatives.map((alternative) => (
            <ListRow
              key={alternative.id}
              title={alternative.name}
              subtitle={`${alternative.muscles
                .filter((muscle) => muscle.role === 'main')
                .map((muscle) => muscle.muscle)
                .join(', ')} · ${alternative.equipment.join(', ')}`}
              disabled={action.busy}
              onPress={() => {
                void swap(alternative);
              }}
            />
          ))
        ) : (
          <>
            <AppText tone="muted">
              No alternative avoids the recorded injured muscles. Consider skipping this
              exercise today.
            </AppText>
            <AppButton
              title="Skip exercise"
              onPress={() => {
                pendingSkip.current = true;
                setOpen(false);
              }}
            />
          </>
        )}
      </Sheet>
    </>
  );
}
