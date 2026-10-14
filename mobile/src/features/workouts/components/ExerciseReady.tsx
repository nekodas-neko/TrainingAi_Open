import { ScrollView } from 'react-native';
import { cappedTarget } from '../logging/targets';
import { plateBreakdown } from '@trainingai/shared/workout/plate-loading';
import { barShareOfOneRm } from '@trainingai/shared/1rm';
import { AppText, Badge, Card, IconButton, Stack } from '../../../shared/ui';
import type { WorkoutExercise, WorkoutRecord, WorkoutSet } from '../logging/workout';
import { formatSetLoad } from '../logging/targets';
import { ExerciseHeading } from './ExerciseHeading';
import { ReadyProgress } from './WorkoutClocks';
import { useTheme } from '../../../shared/theme/ThemeProvider';
import { InjuryControls } from './InjuryControls';
import { PreviousSession } from './PreviousSession';

export function ExerciseReady({
  workout,
  exercise,
  set,
  onSkip,
  onDetails,
}: {
  workout: WorkoutRecord;
  exercise: WorkoutExercise;
  set: WorkoutSet;
  onSkip: () => void;
  onDetails: () => void;
}) {
  const { theme } = useTheme();
  const bodyweight = exercise.exerciseType === 'bodyweight';
  const plates =
    !bodyweight && exercise.equipment.includes('barbell')
      ? plateBreakdown(Number(set.weight))
      : null;
  const cap = cappedTarget(exercise, set);
  return (
    <>
      <ExerciseHeading
        name={exercise.name}
        actions={<IconButton icon="info" label="Exercise details" onPress={onDetails} />}
      />
      <InjuryControls workout={workout} exercise={exercise} onSkip={onSkip} />
      <PreviousSession workout={workout} exercise={exercise} />
      {workout.soloExerciseId && (
        <Badge
          label={
            exercise.relogOf || exercise.lastDate?.replace(/\//g, '-') === workout.date
              ? 'Logging again'
              : 'Solo exercise'
          }
        />
      )}
      {!workout.isBaseline && !bodyweight && Number(set.weight) > 0 && (
        <Card tone="brand">
          <AppText variant="eyebrow" tone="brand" style={{ textAlign: 'center' }}>
            Suggested working load
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
          {plates && (
            <AppText variant="caption" tone="muted" style={{ textAlign: 'center' }}>
              {plates.perSide.length
                ? `${plates.perSide.join(' + ')} kg per side`
                : 'Empty bar'}
              {plates.exact ? '' : ` · closest ${plates.achievableKg} kg`}
            </AppText>
          )}
        </Card>
      )}
      {cap !== null && (
        <AppText variant="caption" tone="muted" style={{ textAlign: 'center' }}>
          Automatic target capped at {cap} kg · the calculated load is above the loading
          limit.
        </AppText>
      )}
      {!workout.soloExerciseId && <ReadyProgress workout={workout} exercise={exercise} />}
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
          <ScrollView nestedScrollEnabled style={{ maxHeight: theme.sizes.timerRing }}>
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
                      item.plannedWeight === null
                        ? item.weight
                        : String(item.plannedWeight),
                    reps: String(item.planned?.reps ?? item.reps),
                  })}
                </AppText>
              </Stack>
            ))}
          </ScrollView>
        </Card>
      ) : null}
      {exercise.deloaded && <Badge label="Deload" />}
      {exercise.lastSetMode && (
        <Badge
          label={exercise.lastSetMode === 'amrap' ? 'Last set AMRAP' : 'Last set +1 rep'}
        />
      )}
    </>
  );
}
