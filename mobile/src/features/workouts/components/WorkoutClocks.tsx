import { Pressable, View } from 'react-native';
import { transitionSecForEquipment } from '@trainingai/shared/workout/duration-model';
import { AppButton, AppText, Icon, ProgressBar, Stack } from '../../../shared/ui';
import { useClock, formatDuration } from '../../../shared/hooks/useClock';
import { useWorkoutJournal } from '../logging/WorkoutJournalProvider';
import { workoutFlow } from '../logging/flow';
import { usePipSourceRect } from '../pip/usePipSourceRect';
import { activeElapsedMs, type WorkoutExercise, type WorkoutRecord } from '../logging/workout';
import { useTheme } from '../../../shared/theme/ThemeProvider';
import { RestRing } from './RestRing';

/** Whether the exercises are under way: the warm-up and the review have nothing to pause (#3255). */
export function canPauseWorkout(workout: WorkoutRecord) {
  const stage = workoutFlow(workout).stage;
  // A pause already open can always be ended, wherever the workout was left.
  return (
    workout.status === 'active' &&
    (workout.pausedAt !== null || stage === 'exercise' || stage === 'summary')
  );
}

/**
 * The Total clock, which is also the pause control: tap it to freeze every clock, tap again to
 * resume (#3255). It counts the time the workout was under way, so a pause is not in it.
 */
export function SessionTimer({ workout }: { workout: WorkoutRecord; ring?: boolean }) {
  const { theme } = useTheme();
  const journal = useWorkoutJournal();
  const paused = workout.pausedAt !== null;
  const now = useClock(workout.status === 'active' && !paused);
  if (!workout.timers.workoutElapsed) {
    return null;
  }
  const elapsed = activeElapsedMs(workout, now) / 1000;
  const pausable = canPauseWorkout(workout);
  const tint = paused ? theme.status.warning : theme.colors.brand;
  const chip = (
    <View
      style={{
        backgroundColor: paused ? `${theme.status.warning}33` : theme.colors.brandSurface,
        borderRadius: theme.radii.control,
        paddingHorizontal: theme.spacing.sm,
        paddingVertical: theme.spacing.xs,
      }}
    >
      <Stack direction="row" align="center" gap="xs">
        <View>
          <AppText variant="micro" tone="muted">
            {paused ? 'Paused' : 'Total'}
          </AppText>
          <AppText variant="caption" style={{ color: tint }}>
            {formatDuration(elapsed)}
          </AppText>
        </View>
        {pausable && <Icon name={paused ? 'play' : 'pause'} color={tint} size={14} />}
      </Stack>
    </View>
  );
  if (!pausable) {
    return chip;
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={paused ? 'Resume workout' : 'Pause workout'}
      disabled={journal.busy || !journal.controller}
      hitSlop={theme.spacing.xs}
      onPress={() => {
        void (paused
          ? journal.controller?.resume(workout.id)
          : journal.controller?.pause(workout.id));
      }}
    >
      {chip}
    </Pressable>
  );
}
/** The banner at the top of a paused workout, with how long it has been paused. */
export function PausedBanner({ workout }: { workout: WorkoutRecord }) {
  const { theme } = useTheme();
  const now = useClock(workout.pausedAt !== null);
  if (workout.pausedAt === null) {
    return null;
  }
  return (
    <View
      accessibilityRole="alert"
      style={{
        alignSelf: 'stretch',
        borderRadius: theme.radii.card,
        borderWidth: 1,
        borderColor: `${theme.status.warning}55`,
        backgroundColor: `${theme.status.warning}1f`,
        padding: theme.spacing.md,
      }}
    >
      <AppText variant="caption" style={{ color: theme.status.warning, fontWeight: '700' }}>
        Workout paused · {formatDuration(Math.max(0, (now - workout.pausedAt) / 1000))}
      </AppText>
      <AppText variant="micro" tone="muted">
        Clocks are stopped. Paused time isn’t counted.
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
export function WarmupTimer({ workout }: { workout: WorkoutRecord }) {
  const now = useClock(workout.timers.warmup);
  const elapsed = Math.max(0, (now - workout.startedAt) / 1000);
  const done = elapsed >= workout.warmupGoalSeconds;
  if (!workout.timers.warmup) {
    return (
      <AppText variant="caption" tone="muted">
        Warm up at your own pace. Begin Exercises when you choose.
      </AppText>
    );
  }
  return (
    <Stack gap="xs">
      <Stack direction="row" justify="space-between">
        <AppText variant="micro" tone="brand">
          {done ? 'Warm-up guide elapsed · continue when ready' : 'WARM-UP GUIDE'}
        </AppText>
        <AppText variant="micro" tone="muted">
          {formatDuration(Math.max(0, workout.warmupGoalSeconds - elapsed))} remaining ·
          guide {formatDuration(workout.warmupGoalSeconds)}
        </AppText>
      </Stack>
      <ProgressBar value={elapsed / workout.warmupGoalSeconds} complete={done} />
      <AppText variant="micro" tone="muted">
        {workout.warmupGoalSource === 'selected'
          ? 'Your selected timer duration.'
          : workout.warmupGoalSource === 'budget'
            ? 'Planning allowance: 15% of the session budget.'
            : 'Default 10-minute guide; no session time limit was chosen.'}{' '}
        Time alone does not complete a warm-up. Adjust or hide it in Workout options.
      </AppText>
    </Stack>
  );
}
export function ReadyProgress({
  workout,
  exercise,
}: {
  workout: WorkoutRecord;
  exercise: WorkoutExercise;
}) {
  const clock = useClock(
    workout.timers.setup && exercise.readyStartedAt !== null && workout.pausedAt === null,
  );
  const now = workout.pausedAt ?? clock;
  if (!workout.timers.setup || exercise.readyStartedAt === null) {
    return null;
  }
  const elapsed = Math.max(0, (now - exercise.readyStartedAt) / 1000);
  const total =
    workout.timers.setupSeconds ?? transitionSecForEquipment(exercise.equipment);
  return (
    <Stack gap="xs">
      <Stack direction="row" justify="space-between">
        <AppText variant="micro" tone="muted">
          Preparation
        </AppText>
        <AppText variant="micro" tone="muted">
          {formatDuration(Math.max(0, total - elapsed))} remaining
        </AppText>
      </Stack>
      <ProgressBar value={elapsed / total} complete={elapsed >= total} />
    </Stack>
  );
}
export function RestCard({
  workout,
  compact = false,
  controls = true,
  onStartSet,
}: {
  workout: WorkoutRecord;
  compact?: boolean;
  // Off for the last set's rest on the exercise summary, which shows only the caption and ring,
  // as the current app's LastSetRestTimer does (#3111).
  controls?: boolean;
  onStartSet?: () => void;
}) {
  const clock = useClock(workout.pausedAt === null);
  const source = usePipSourceRect();
  const paused = workout.pausedAt !== null;
  // Under a pause the rest stands where it was stopped; resuming moves its anchors on.
  const now = workout.pausedAt ?? clock;
  const journal = useWorkoutJournal();
  const { theme } = useTheme();
  if (!workout.rest) {
    return null;
  }
  const total = (workout.rest.endsAt - workout.rest.startedAt) / 1000;
  const remaining = Math.max(0, Math.ceil((workout.rest.endsAt - now) / 1000));
  const overtime = Math.max(0, Math.floor((now - workout.rest.endsAt) / 1000));
  const expired = now >= workout.rest.endsAt;
  if (compact) {
    return (
      <Stack gap="xs">
        <Stack direction="row" justify="space-between">
          <AppText variant="micro" tone="brand">
            LAST SET REST
          </AppText>
          <AppText variant="micro" tone="muted">
            {expired ? `+${formatDuration(overtime)}` : formatDuration(remaining)} /{' '}
            {formatDuration(total)}
          </AppText>
        </Stack>
        <ProgressBar
          value={expired ? 1 : total > 0 ? remaining / total : 0}
          color={expired ? theme.anatomy.injured : undefined}
        />
      </Stack>
    );
  }
  // Whole seconds since the rest began, as the current app's useElapsedSec counts them.
  const elapsed = Math.max(0, Math.floor((now - workout.rest.startedAt) / 1000));
  const ringOvertime = elapsed > total;
  const labelColor = paused
    ? theme.status.warning
    : ringOvertime
      ? theme.anatomy.injured
      : theme.colors.muted;
  const ring = (
    <View
      ref={source.ref}
      onLayout={source.onLayout}
      collapsable={false}
      style={{ opacity: paused ? 0.55 : 1 }}
    >
      <RestRing elapsedSec={elapsed} targetSec={total} />
    </View>
  );
  const startable = onStartSet && !paused;
  return (
    <Stack align="center" gap="md">
      {/* The current app's RestTimer and LastSetRestTimer: a muted label that turns red in
          overtime, the shared ring, and the hint in the label's colour at 60% (#3142). */}
      <AppText variant="eyebrow" style={{ color: labelColor, fontWeight: '700' }}>
        {paused ? 'REST · PAUSED' : ringOvertime ? 'OVERTIME' : onStartSet ? 'REST' : 'RESTING'}
      </AppText>
      {startable ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={
            ringOvertime
              ? `${elapsed - total}s overtime, tap to start`
              : `${total - elapsed} seconds remaining, tap to skip`
          }
          onPress={onStartSet}
        >
          {ring}
        </Pressable>
      ) : (
        ring
      )}
      {startable && (
        <AppText variant="caption" style={{ color: labelColor, opacity: 0.6 }}>
          {ringOvertime ? 'Rest complete · Tap to start' : 'Tap to start early'}
        </AppText>
      )}
      {controls && (
        <>
          <AppText variant="micro" tone="muted">
            Actual rest {formatDuration(Math.max(0, (now - workout.rest.startedAt) / 1000))} ·
            adjusted target {formatDuration(total)}
          </AppText>
          <Stack direction="row">
            <AppButton
              title="−30s"
              variant="surface"
              disabled={journal.busy || paused || total < 30}
              onPress={() => {
                void journal.controller?.adjustRest(workout.id, -30);
              }}
            />
            <AppButton
              title="+30s"
              variant="surface"
              disabled={journal.busy || paused || total > 86370}
              onPress={() => {
                void journal.controller?.adjustRest(workout.id, 30);
              }}
            />
          </Stack>
        </>
      )}
    </Stack>
  );
}
