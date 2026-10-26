import { Pressable, View } from 'react-native';
import { AppText, Icon, Stack } from '../../../shared/ui';
import { useTheme } from '../../../shared/theme/ThemeProvider';
import { useClock, formatDuration } from '../../../shared/hooks/useClock';
import { useWorkoutJournal } from '../logging/WorkoutJournalProvider';
import { workoutActivity } from '../logging/activity-summary';
import { activeElapsedMs, type WorkoutRecord } from '../logging/workout';

function WorkoutBar({
  workout,
  onResume,
}: {
  workout: WorkoutRecord;
  onResume: (id: string) => void;
}) {
  const { theme } = useTheme();
  const clock = useClock(workout.pausedAt === null);
  // Under a pause every clock stands where it stopped.
  const now = workout.pausedAt ?? clock;
  const activity = workoutActivity(workout, now);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Resume ${workout.sessionName}`}
      onPress={() => onResume(workout.id)}
      style={{
        padding: theme.spacing.md,
        paddingBottom: theme.spacing.md + theme.sizes.workoutLift,
        backgroundColor: theme.colors.brandSurface,
        borderTopWidth: 1,
        borderTopColor: theme.colors.brandBorder,
        minHeight: theme.sizes.touchTarget,
      }}
    >
      <Stack direction="row" align="center" gap="md">
        <Icon name="workout" tone="brand" />
        <View style={{ flex: 1, minWidth: 0 }}>
          <AppText variant="label" numberOfLines={1}>
            {workout.sessionName}
          </AppText>
          <AppText variant="micro" tone="muted" numberOfLines={1}>
            {workout.pausedAt === null ? '' : 'Paused · '}
            {activity.label}
            {activity.seconds === null
              ? ''
              : ` · ${activity.timer} ${formatDuration(activity.seconds)}`}
          </AppText>
        </View>
        {workout.timers.workoutElapsed && (
          <AppText variant="caption" tone="brand">
            Total {formatDuration(activeElapsedMs(workout, now) / 1000)}
          </AppText>
        )}
        <Icon name="forward" tone="brand" />
      </Stack>
    </Pressable>
  );
}
export function ActiveWorkoutBar({ onResume }: { onResume: (id: string) => void }) {
  const journal = useWorkoutJournal();
  const workout = journal.ready
    ? journal.data.workouts.find((workout) => workout.status === 'active')
    : undefined;
  return workout ? <WorkoutBar workout={workout} onResume={onResume} /> : null;
}
