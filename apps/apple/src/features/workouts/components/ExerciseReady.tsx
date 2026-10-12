import { cappedTarget } from '../logging/targets';
import { plateBreakdown } from '@trainingai/shared/workout/plate-loading';
import { displayOneRm, oneRmLabel, barShareOfOneRm } from '@trainingai/shared/1rm';
import { View } from 'react-native';
import { AppText, Badge, Card, Disclosure, MuscleMap, Stack } from '../../../shared/ui';
import type { WorkoutExercise, WorkoutRecord, WorkoutSet } from '../logging/workout';
import { formatSetLoad } from '../logging/targets';
import { SetEntry } from './SetEntry';
import { ExerciseHeading } from './ExerciseHeading';
import { ReadyProgress } from './WorkoutClocks';
import { useTheme } from '../../../shared/theme/ThemeProvider';
import { InjuryControls } from './InjuryControls';
import { ExerciseHistory } from './ExerciseHistory';

export function ExerciseReady({
  workout,
  exercise,
  set,
  onSkip,
}: {
  workout: WorkoutRecord;
  exercise: WorkoutExercise;
  set: WorkoutSet;
  onSkip: () => void;
}) {
  const { theme } = useTheme();
  const bodyweight = exercise.exerciseType === 'bodyweight';
  const plates =
    !bodyweight && exercise.equipment.includes('barbell')
      ? plateBreakdown(Number(set.weight))
      : null;
  const cap = cappedTarget(exercise, set);
  const assignments = [
    ...(exercise.mainMuscles.length ? exercise.mainMuscles : exercise.muscles).map(
      (muscle) => ({
        muscle,
        role: 'main' as const,
      }),
    ),
    ...exercise.secondaryMuscles.map((muscle) => ({ muscle, role: 'secondary' as const })),
  ];
  return (
    <>
      <ExerciseHeading name={exercise.name} />
      <InjuryControls workout={workout} exercise={exercise} onSkip={onSkip} />
      {exercise.lastDate && exercise.lastReps.length > 0 && (
        <Card style={{ padding: theme.spacing.md }}>
          <AppText variant="micro" tone="muted">
            Last session — {exercise.lastDate}
          </AppText>
          <Stack direction="row" justify="space-between" align="center">
            <Stack direction="row" wrap>
              {exercise.lastReps.map((reps, index) => (
                <Badge
                  key={index}
                  label={formatSetLoad(exercise, {
                    weight: String(
                      exercise.lastWeights[index] ?? exercise.lastWeights.at(-1) ?? 0,
                    ),
                    reps: String(reps),
                  })}
                />
              ))}
            </Stack>
            {exercise.estimated1rm !== null && (
              <AppText variant="label" tone="brand">
                {displayOneRm(exercise.estimated1rm, exercise.exerciseType).text}
              </AppText>
            )}
          </Stack>
        </Card>
      )}
      {!workout.isBaseline && !bodyweight && Number(set.weight) > 0 && (
        <Card tone="brand">
          <AppText variant="eyebrow" tone="brand" style={{ textAlign: 'center' }}>
            Load the bar to
          </AppText>
          <AppText variant="display" tone="brand" style={{ textAlign: 'center' }}>
            {set.weight} kg
          </AppText>
          {set.planned && (
            <AppText variant="caption" tone="muted" style={{ textAlign: 'center' }}>
              {barShareOfOneRm(Number(set.weight), exercise.estimated1rm) ??
                set.planned.percent}
              % of 1RM · {set.planned.reps} reps per set
            </AppText>
          )}
        </Card>
      )}
      {cap !== null && (
        <AppText variant="caption" tone="muted" style={{ textAlign: 'center' }}>
          Automatic target capped at {cap} kg · the calculated load is above the loading limit.
        </AppText>
      )}
      {plates && (
        <AppText variant="caption" tone="muted" style={{ textAlign: 'center' }}>
          {plates.perSide.length ? `${plates.perSide.join(' + ')} kg per side` : 'Empty bar'}
          {plates.exact ? '' : ` · closest ${plates.achievableKg} kg`}
        </AppText>
      )}
      <ReadyProgress
        exercise={exercise}
        weight={Number(set.weight)}
        baseline={workout.isBaseline}
      />
      {workout.isBaseline ? (
        <Card tone="brand">
          <AppText variant="eyebrow" tone="brand" style={{ textAlign: 'center' }}>
            AMRAP Test
          </AppText>
          <AppText variant="caption" tone="muted">
            {bodyweight
              ? 'Do as many reps as possible with good form.'
              : 'Pick a weight you can manage for 8–15 reps. Do as many reps as possible with good form — this sets your working weights for the program.'}
          </AppText>
        </Card>
      ) : !bodyweight && exercise.sets.some((set) => set.planned !== null) ? (
        <Card tone="brand">
          <AppText variant="eyebrow" tone="brand" style={{ textAlign: 'center' }}>
            Set targets
          </AppText>
          {exercise.sets.map((item, index) => (
            <Stack key={item.id} direction="row" justify="space-between">
              <AppText variant="caption" tone="muted">
                Set {index + 1}
                {item.planned
                  ? ` (${barShareOfOneRm(item.plannedWeight, exercise.estimated1rm) ?? item.planned.percent}%)`
                  : ''}
              </AppText>
              <AppText variant="label" tone="brand">
                {formatSetLoad(exercise, {
                  weight:
                    item.plannedWeight === null ? item.weight : String(item.plannedWeight),
                  reps: String(item.planned?.reps ?? item.reps),
                })}
              </AppText>
            </Stack>
          ))}
        </Card>
      ) : null}
      {exercise.deloaded && <Badge label="Deload" />}
      {exercise.lastSetMode && (
        <Badge
          label={exercise.lastSetMode === 'amrap' ? 'Last set AMRAP' : 'Last set +1 rep'}
        />
      )}
      {assignments.length > 0 && (
        <View style={{ height: theme.sizes.timerRing * 2 }}>
          <MuscleMap assignments={assignments} />
        </View>
      )}
      {exercise.instructions && (
        <Disclosure title="Technique">
          <AppText variant="caption" tone="muted">
            {exercise.instructions}
          </AppText>
        </Disclosure>
      )}
      <Disclosure title="Adjust starting set">
        <SetEntry workout={workout} exercise={exercise} set={set} index={0} />
      </Disclosure>
      <Disclosure title="Exercise history">
        <ExerciseHistory name={exercise.name} />
      </Disclosure>
    </>
  );
}
