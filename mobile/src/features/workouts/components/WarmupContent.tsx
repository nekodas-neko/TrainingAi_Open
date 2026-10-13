import { View } from 'react-native';
import { AppText, Badge, Card, MuscleMap, Stack } from '../../../shared/ui';
import { useTheme } from '../../../shared/theme/ThemeProvider';
import type { WorkoutRecord } from '../logging/workout';
import { WarmupTimer } from './WorkoutClocks';
import { SessionExerciseList } from './SessionExerciseList';

export function WarmupContent({ workout }: { workout: WorkoutRecord }) {
  const { theme } = useTheme();
  const muscles = [
    ...new Set(
      workout.exercises.flatMap((exercise) =>
        exercise.mainMuscles.length ? exercise.mainMuscles : exercise.muscles,
      ),
    ),
  ];
  const assignments = muscles.map((muscle) => ({ muscle, role: 'main' as const }));
  return (
    <>
      <WarmupTimer workout={workout} />
      <Stack direction="row" align="stretch" gap="md">
        <Card tone="brand" style={{ flex: 1, padding: theme.spacing.md }}>
          <AppText variant="eyebrow" tone="brand">
            Focus on warming up
          </AppText>
          <Stack direction="row" wrap gap="xs">
            {muscles.map((muscle) => (
              <Badge key={muscle} label={muscle} tone="brand" />
            ))}
          </Stack>
        </Card>
        <View
          style={{ width: theme.sizes.demonstration * 2, height: theme.sizes.demonstration * 2 }}
        >
          <MuscleMap assignments={assignments} />
        </View>
      </Stack>
      <AppText variant="eyebrow" tone="brand">
        Today's exercises
      </AppText>
      <SessionExerciseList
        exercises={workout.exercises.map((exercise) => ({
          ...exercise,
          setCount: exercise.sets.length,
          sets: [],
        }))}
      />
      <Card style={{ padding: theme.spacing.md }}>
        <AppText variant="eyebrow" tone="muted">
          General warmup
        </AppText>
        {[
          '5 min cardio — raise core temperature',
          "Dynamic stretches for today's muscles",
          '2–3 ramp-up sets at 40–60% of working weight',
        ].map((tip) => (
          <AppText key={tip} variant="caption" tone="muted">
            • {tip}
          </AppText>
        ))}
      </Card>
    </>
  );
}
