import { View } from 'react-native';
import { transitionSecForEquipment } from '@trainingai/shared/workout/duration-model';
import { AppText, Badge, Card, ProgressBar, Stack, TimerRing } from '../../../shared/ui';
import { useClock, formatDuration } from '../../../shared/hooks/useClock';
import { useWorkoutJournal } from '../logging/WorkoutJournalProvider';
import type { WorkoutExercise, WorkoutRecord } from '../logging/workout';
import { useTheme } from '../../../shared/theme/ThemeProvider';
import { roundLoad, weightStep } from '../logging/targets';

export function SessionTimer({
  workout,
  ring = false,
}: {
  workout: WorkoutRecord;
  ring?: boolean;
}) {
  const { theme } = useTheme();
  const now = useClock(workout.status === 'active');
  const elapsed = Math.max(0, ((workout.completedAt ?? now) - workout.startedAt) / 1000);
  return ring ? (
    <TimerRing compact value={formatDuration(elapsed)} progress={(elapsed % 3600) / 3600} />
  ) : (
    <View
      style={{
        backgroundColor: theme.colors.brandSurface,
        borderRadius: theme.radii.control,
        paddingHorizontal: theme.spacing.sm,
        paddingVertical: theme.spacing.xs,
      }}
    >
      <AppText variant="caption" tone="brand">
        {formatDuration(elapsed)}
      </AppText>
    </View>
  );
}
export function WorkoutClock({ workout }: { workout: WorkoutRecord }) {
  const journal = useWorkoutJournal();
  return (
    <Stack direction="row" justify="space-between">
      <SessionTimer workout={workout} />
      <AppText variant="micro" tone="muted">
        {journal.saveStatus === 'saved'
          ? 'Saved on phone'
          : journal.saveStatus === 'saving'
            ? 'Saving…'
            : 'Save failed'}
      </AppText>
    </Stack>
  );
}
export function SetClock({ startedAt }: { startedAt: number }) {
  const now = useClock();
  return (
    <AppText variant="caption" tone="muted" style={{ textAlign: 'center' }}>
      {formatDuration((now - startedAt) / 1000)} set
    </AppText>
  );
}
export function WarmupTimer({ workout }: { workout: WorkoutRecord }) {
  const now = useClock();
  const elapsed = Math.max(0, (now - workout.startedAt) / 1000);
  const done = elapsed >= workout.warmupGoalSeconds;
  return (
    <Stack gap="xs">
      <Stack direction="row" justify="space-between">
        <AppText variant="micro" tone="brand">
          {done ? '✓ Warm up complete' : 'WARM UP TIMER'}
        </AppText>
        <AppText variant="micro" tone="muted">
          {formatDuration(Math.min(elapsed, workout.warmupGoalSeconds))} /{' '}
          {formatDuration(workout.warmupGoalSeconds)}
        </AppText>
      </Stack>
      <ProgressBar value={elapsed / workout.warmupGoalSeconds} complete={done} />
    </Stack>
  );
}
export function ReadyProgress({
  exercise,
  weight,
  baseline,
}: {
  exercise: WorkoutExercise;
  weight: number;
  baseline: boolean;
}) {
  const { theme } = useTheme();
  const now = useClock(exercise.readyStartedAt !== null);
  const elapsed =
    exercise.readyStartedAt === null ? null : Math.max(0, (now - exercise.readyStartedAt) / 1000);
  const total = transitionSecForEquipment(exercise.equipment);
  const ramp = !baseline && exercise.exerciseType !== 'bodyweight' && weight > 0;
  const step = weightStep(exercise.equipment);
  return (
    <Stack gap="xs">
      <Stack direction="row" justify="space-between">
        <AppText variant="micro" tone="brand">
          {ramp ? 'WARM-UP RAMP' : 'GET READY'}
        </AppText>
        <AppText variant="micro" tone="muted">
          {elapsed === null
            ? ''
            : `${formatDuration(Math.min(elapsed, total))} / ${formatDuration(total)}`}
        </AppText>
      </Stack>
      {ramp ? (
        <Stack direction="row" gap="xs">
          {[
            { pct: 50, reps: 5, label: 'Prep' },
            { pct: 74, reps: 3, label: 'Activate' },
            { pct: 92, reps: 1, label: 'Potentiate' },
          ].map((stage, index) => {
            const progress = elapsed === null ? 0 : (elapsed - (index * total) / 3) / (total / 3);
            const load = roundLoad((weight * stage.pct) / 100, step);
            return (
              <Card key={stage.label} tone="brand" style={{ flex: 1, padding: theme.spacing.sm }}>
                <AppText variant="micro" tone="brand">
                  {stage.label}
                </AppText>
                <AppText variant="caption">
                  {load} kg × {stage.reps}
                </AppText>
                <ProgressBar value={progress} complete={progress >= 1} />
              </Card>
            );
          })}
        </Stack>
      ) : (
        <Card tone="brand" style={{ padding: theme.spacing.sm }}>
          <AppText variant="micro" tone="brand" style={{ textAlign: 'center' }}>
            {elapsed !== null && elapsed >= total ? '✓ Ready' : 'Get set up'}
          </AppText>
          <ProgressBar
            value={(elapsed ?? 0) / total}
            complete={elapsed !== null && elapsed >= total}
          />
        </Card>
      )}
    </Stack>
  );
}
export function RestCard({
  workout,
  compact = false,
  onStartSet,
}: {
  workout: WorkoutRecord;
  compact?: boolean;
  onStartSet?: () => void;
}) {
  const now = useClock();
  if (!workout.rest) {
    return null;
  }
  const total = (workout.rest.endsAt - workout.rest.startedAt) / 1000;
  const remaining = Math.max(0, Math.ceil((workout.rest.endsAt - now) / 1000));
  const overtime = Math.max(0, Math.floor((now - workout.rest.endsAt) / 1000));
  if (compact) {
    return (
      <Stack gap="xs">
        <Stack direction="row" justify="space-between">
          <AppText variant="micro" tone="brand">
            LAST SET REST
          </AppText>
          <AppText variant="micro" tone="muted">
            {overtime > 0 ? `+${formatDuration(overtime)}` : formatDuration(remaining)} /{' '}
            {formatDuration(total)}
          </AppText>
        </Stack>
        <ProgressBar value={remaining / total} />
      </Stack>
    );
  }
  return (
    <Stack align="center" gap="md">
      <AppText variant="eyebrow" tone="brand">
        {overtime > 0 ? 'OVERTIME' : onStartSet ? 'REST' : 'RESTING'}
      </AppText>
      <TimerRing
        value={overtime > 0 ? `+${overtime}` : String(remaining)}
        caption={overtime > 0 ? `target ${total}s` : `of ${total}s`}
        progress={remaining / total}
        overtime={overtime > 0}
        onPress={onStartSet}
      />
      {onStartSet && (
        <AppText variant="caption" tone="muted">
          {overtime > 0 ? 'Rest complete · Tap to start' : 'Tap to start early'}
        </AppText>
      )}
    </Stack>
  );
}
