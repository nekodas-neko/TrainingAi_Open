import { useState } from 'react';
import { transitionSecForEquipment } from '@trainingai/shared/workout/duration-model';
import { AppButton, AppText, NumericStepper, Stack, SwitchRow } from '../../../shared/ui';
import { useWorkoutJournal } from '../logging/WorkoutJournalProvider';
import type { WorkoutRecord } from '../logging/workout';
import { workoutFlow } from '../logging/flow';

export function WorkoutTimerControls({
  workout,
  onClose,
}: {
  workout: WorkoutRecord;
  onClose: () => void;
}) {
  const journal = useWorkoutJournal();
  const [remember, setRemember] = useState(false);
  const exercise = workout.exercises.find(
    (x) => x.id === workoutFlow(workout).exerciseId,
  );
  const configure = (
    patch: Parameters<NonNullable<typeof journal.controller>['configureTimers']>[1],
  ) => {
    void journal.controller?.configureTimers(workout.id, patch, remember);
  };
  return (
    <>
      <AppText variant="caption" tone="muted">
        Clocks guide pacing. Actual workout, warm-up, set and rest durations keep
        recording when displays are off. Nothing advances automatically.
      </AppText>
      {workout.soloExerciseId && (
        <AppText variant="caption" tone="muted">
          Solo logging skips the setup countdown.
        </AppText>
      )}
      <SwitchRow
        label="Remember changes for future workouts"
        value={remember}
        onValueChange={setRemember}
      />
      <SwitchRow
        label="Total workout elapsed"
        value={workout.timers.workoutElapsed}
        onValueChange={(workoutElapsed) => configure({ workoutElapsed })}
        disabled={journal.busy}
      />
      <SwitchRow
        label="Rest complete sound & vibration"
        value={workout.timers.restCues}
        onValueChange={(restCues) => configure({ restCues })}
        disabled={journal.busy}
      />
      <AppText variant="caption" tone="muted">
        Allow notification sounds when prompted. Lock-screen alerts use your Alerts &
        calendar settings.
      </AppText>
      <SwitchRow
        label="Set work elapsed"
        value={workout.timers.setElapsed}
        onValueChange={(setElapsed) => configure({ setElapsed })}
        disabled={journal.busy}
      />
      <SwitchRow
        label="Warm-up countdown"
        value={workout.timers.warmup}
        onValueChange={(warmup) => configure({ warmup })}
        disabled={journal.busy}
      />
      <NumericStepper
        label="Warm-up guide (seconds)"
        value={String(workout.warmupGoalSeconds)}
        step={30}
        min={30}
        max={3600}
        disabled={journal.busy || !workout.timers.warmup}
        onChange={(value) => {
          const warmupSeconds = Number(value);
          if (
            Number.isInteger(warmupSeconds) &&
            warmupSeconds >= 30 &&
            warmupSeconds <= 3600
          ) {
            configure({ warmupSeconds });
          }
        }}
      />
      <SwitchRow
        label="Exercise setup countdown"
        value={workout.timers.setup}
        onValueChange={(setup) => configure({ setup })}
        disabled={journal.busy}
      />
      <NumericStepper
        label="Setup guide (seconds)"
        value={String(
          workout.timers.setupSeconds ?? transitionSecForEquipment(exercise?.equipment),
        )}
        step={30}
        min={30}
        max={3600}
        disabled={journal.busy || !workout.timers.setup}
        onChange={(value) => {
          const setupSeconds = Number(value);
          if (
            Number.isInteger(setupSeconds) &&
            setupSeconds >= 30 &&
            setupSeconds <= 3600
          ) {
            configure({ setupSeconds });
          }
        }}
      />
      <Stack gap="xs">
        <AppText variant="micro" tone="muted">
          {workout.timers.setupSeconds === null
            ? 'The default setup duration is an equipment-based planning allowance.'
            : 'The setup duration is your selected guide.'}{' '}
          Start Set remains your choice.
        </AppText>
        <AppText variant="caption" tone="muted">
          Between-set rest stays enabled. Use its adjustment controls during rest; the
          prescription stays unchanged. Exercise summaries have no deadline.
        </AppText>
        <AppButton
          title="Use equipment setup estimate"
          variant="ghost"
          disabled={journal.busy}
          onPress={() => configure({ setupSeconds: null })}
        />
      </Stack>
      <AppButton title="Done" onPress={onClose} />
    </>
  );
}
