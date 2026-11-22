import { AppButton, AppText, Card, Stack } from '../../../shared/ui';
import { useTheme } from '../../../shared/theme/ThemeProvider';
import { useCoachLaunch } from '../../coach/CoachProvider';
import type { WorkoutRecord } from '../logging/workout';

/** The lifts of a finished workout that "Adjust" can open the Coach about: one row per exercise
 *  with a set done, without the archived and re-logged copies. */
export function recapLifts(workout: Pick<WorkoutRecord, 'exercises'>) {
  return workout.exercises
    .filter(
      (exercise) =>
        !exercise.retired &&
        !exercise.relogOf &&
        !exercise.skipped &&
        exercise.sets.some((set) => set.completedAt != null),
    )
    .map((exercise) => ({ sessionExerciseId: exercise.id, name: exercise.name }));
}

/** "Adjust" beside each lift on the recap (#3896 step 6, 8a A): opens the Coach about that lift. */
export function RecapLifts({ workout }: { workout: Pick<WorkoutRecord, 'exercises'> }) {
  const { theme } = useTheme();
  const launch = useCoachLaunch();
  const lifts = recapLifts(workout);
  if (lifts.length === 0) return null;
  return (
    <Card style={{ width: '100%', maxWidth: theme.sizes.summaryWidth }}>
      <AppText variant="eyebrow" tone="muted">
        Your lifts
      </AppText>
      {lifts.map((lift) => (
        <Stack key={lift.sessionExerciseId} direction="row" align="center" justify="space-between">
          <AppText variant="caption" style={{ flex: 1 }}>
            {lift.name}
          </AppText>
          <AppButton
            title="Adjust"
            variant="ghost"
            accessibilityLabel={`Adjust ${lift.name}`}
            onPress={() =>
              launch({ context: { origin: 'exercise', sessionExerciseId: lift.sessionExerciseId } })
            }
          />
        </Stack>
      ))}
    </Card>
  );
}
