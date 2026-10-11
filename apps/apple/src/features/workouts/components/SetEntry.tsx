import { barShareOfOneRm } from '@trainingai/shared/1rm';
import { View } from 'react-native';
import {
  AppButton,
  AppText,
  Badge,
  Disclosure,
  NumberWheel,
  NumericStepper,
  RepCounter,
  Stack,
} from '../../../shared/ui';
import type { WorkoutExercise, WorkoutRecord, WorkoutSet } from '../logging/workout';
import { useWorkoutJournal } from '../logging/WorkoutJournalProvider';
import { isAmrap, weightStep } from '../logging/targets';
import { EffortPicker } from './EffortPicker';
import { useTheme } from '../../../shared/theme/ThemeProvider';

export function SetEntry({
  workout,
  exercise,
  set,
  index,
}: {
  workout: WorkoutRecord;
  exercise: WorkoutExercise;
  set: WorkoutSet;
  index: number;
}) {
  const journal = useWorkoutJournal();
  const { theme } = useTheme();
  const bodyweight = exercise.exerciseType === 'bodyweight';
  const amrap = isAmrap(workout, exercise, index);
  const percent =
    barShareOfOneRm(Number(set.weight), exercise.estimated1rm) ?? set.planned?.percent;
  const update = (field: 'weight' | 'reps', value: string) =>
    journal.controller?.updateSet(workout.id, exercise.id, set.id, field, value);
  return (
    <Stack gap="md">
      <Stack direction="row" justify="space-between" align="center">
        <Badge label={amrap ? 'A' : String(index + 1)} tone="brand" />
        {!bodyweight && percent !== undefined && <Badge label={`${percent}% 1RM`} tone="brand" />}
      </Stack>
      <Stack direction="row" align="center" gap="md">
        {!bodyweight && (
          <NumberWheel
            label="kg"
            value={set.weight}
            onChange={(value) => update('weight', value)}
            step={weightStep(exercise.equipment)}
            max={500}
            disabled={journal.busy}
          />
        )}
        <View style={{ flex: 1, minWidth: 0 }}>
          <RepCounter
            value={set.reps}
            onChange={(value) => update('reps', value)}
            label={`Reps for ${exercise.name}, set ${index + 1}`}
            disabled={journal.busy}
          />
          {amrap && (
            <AppText variant="micro" tone="brand" style={{ textAlign: 'center' }}>
              AMRAP · beat it
            </AppText>
          )}
        </View>
      </Stack>
      {bodyweight && (
        <Disclosure
          title={
            Number(set.weight) === 0
              ? 'Add load / assistance'
              : `${Number(set.weight) > 0 ? '+' : ''}${set.weight} kg load / assistance`
          }
        >
          <NumericStepper
            label="Added / assisted load (kg)"
            value={set.weight}
            onChange={(value) => update('weight', value)}
            step={weightStep(exercise.equipment)}
            min={-100}
            max={500}
            disabled={journal.busy}
          />
        </Disclosure>
      )}
      <AppText variant="micro" tone="muted" style={{ textAlign: 'center' }}>
        Voice logging · coming soon
      </AppText>
      <EffortPicker
        set={set}
        disabled={journal.busy}
        onChange={(rpe) => {
          void journal.controller?.rateSet(workout.id, exercise.id, set.id, rpe);
        }}
      />
    </Stack>
  );
}
export function SetActions({
  workout,
  exercise,
  set,
  index,
}: {
  workout: WorkoutRecord;
  exercise: WorkoutExercise;
  set: WorkoutSet;
  index: number;
}) {
  const journal = useWorkoutJournal();
  const running = workout.runningSet?.setId === set.id;
  return (
    <AppButton
      title={running ? `Log Set ${index + 1}` : `Start Set ${index + 1}`}
      disabled={journal.busy || (!!workout.runningSet && !running)}
      onPress={() => {
        void (running
          ? journal.controller?.recordSet(workout.id, exercise.id, set.id)
          : journal.controller?.startSet(workout.id, exercise.id, set.id));
      }}
    />
  );
}
