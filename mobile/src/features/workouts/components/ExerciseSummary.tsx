import { bodyweightRepMax, displayOneRm, oneRmLabel } from '@trainingai/shared/1rm';
import { View } from 'react-native';
import { AppText, Card, Icon, Stack } from '../../../shared/ui';
import { useTheme } from '../../../shared/theme/ThemeProvider';
import { formatDuration } from '../../../shared/hooks/useClock';
import type { WorkoutExercise, WorkoutRecord } from '../logging/workout';
import { exerciseResult } from '../logging/summary';
import { formatSetLoad } from '../logging/targets';
import { RestCard } from './WorkoutClocks';

export function ExerciseSummary({
  workout,
  exercise,
  next,
}: {
  workout: WorkoutRecord;
  exercise: WorkoutExercise;
  next?: WorkoutExercise;
}) {
  const result = exerciseResult(workout, exercise);
  const { theme } = useTheme();
  const previous =
    exercise.exerciseType === 'bodyweight'
      ? bodyweightRepMax({ storedReps: exercise.prevRepMaxReps, oneRm: exercise.estimated1rm })
      : exercise.estimated1rm;
  const current = exercise.exerciseType === 'bodyweight' ? result.repMax : result.estimate;
  const difference =
    !workout.isBaseline && !exercise.deloaded && previous !== null && current !== null
      ? current - previous
      : null;
  const color =
    difference === null
      ? theme.colors.text
      : difference > 0.1
        ? theme.anatomy.main
        : difference < -0.1
          ? theme.anatomy.injured
          : theme.colors.muted;
  const compact = { padding: theme.spacing.md, gap: theme.spacing.sm };
  return (
    <>
      <RestCard workout={workout} />
      {next && (
        <Card style={compact}>
          <AppText variant="eyebrow" tone="muted">
            Up Next
          </AppText>
          <Stack direction="row" justify="space-between">
            <AppText variant="label" style={{ flex: 1 }}>
              {next.name}
            </AppText>
            <AppText variant="label" tone="muted">
              {next.exerciseType === 'bodyweight' && Number(next.sets[0].weight) === 0
                ? 'Bodyweight'
                : `${next.sets[0].weight} kg`}
            </AppText>
          </Stack>
        </Card>
      )}
      <Card style={compact}>
        <AppText variant="eyebrow" tone="muted">
          Sets
        </AppText>
        {exercise.sets.map((set, index) =>
          set.completedAt === null ? null : (
            <Stack key={set.id} direction="row" align="center" justify="space-between">
              <View
                style={{
                  width: theme.sizes.iconSmall,
                  height: theme.sizes.iconSmall,
                  backgroundColor: theme.colors.brandSurface,
                  borderRadius: theme.radii.pill,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <AppText variant="micro" tone="brand">
                  {index + 1}
                </AppText>
              </View>
              <AppText variant="label" style={{ flex: 1 }}>
                {formatSetLoad(exercise, set)}
              </AppText>
              {set.startedAt !== null && (
                <AppText variant="caption" tone="muted">
                  {formatDuration((set.completedAt - set.startedAt) / 1000)}
                </AppText>
              )}
            </Stack>
          ),
        )}
        {exercise.sets.some((set) => set.restAfterSec !== null) && (
          <Stack direction="row" justify="space-between">
            <AppText variant="micro" tone="muted">
              Total rest
            </AppText>
            <AppText variant="micro" tone="muted">
              {formatDuration(exercise.sets.reduce((sum, set) => sum + (set.restAfterSec ?? 0), 0))}
            </AppText>
          </Stack>
        )}
      </Card>
      <Card style={compact}>
        <Stack direction="row" justify="space-between">
          <AppText variant="eyebrow" tone="muted">
            {oneRmLabel(exercise.exerciseType)}
          </AppText>
          {difference !== null && Math.abs(difference) > 0.1 && (
            <AppText variant="micro" style={{ color }}>
              {difference > 0 ? '+' : ''}
              {exercise.exerciseType === 'bodyweight'
                ? `${difference} reps`
                : `${difference.toFixed(2)} kg`}
            </AppText>
          )}
        </Stack>
        <Stack direction="row" justify="space-between">
          <Stack gap="xs">
            <AppText variant="micro" tone="muted">
              Previous
            </AppText>
            <AppText variant="heading">
              {previous === null
                ? '—'
                : exercise.exerciseType === 'bodyweight'
                  ? `${previous} RM`
                  : displayOneRm(previous, exercise.exerciseType).text}
            </AppText>
          </Stack>
          {difference !== null && (
            <Icon
              name={difference > 0.1 ? 'up' : difference < -0.1 ? 'down' : 'forward'}
              color={color}
            />
          )}
          <Stack gap="xs" align="flex-start">
            <AppText variant="micro" tone="muted">
              This session
            </AppText>
            <AppText variant="heading" style={{ color }}>
              {result.repMax !== null
                ? `${result.repMax} RM`
                : result.estimate === null
                  ? '—'
                  : displayOneRm(result.estimate, exercise.exerciseType).text}
            </AppText>
          </Stack>
        </Stack>
        {difference !== null && Math.abs(difference) <= 0.1 && (
          <AppText variant="micro" tone="muted" style={{ textAlign: 'center' }}>
            Consistent — solid work
          </AppText>
        )}
        {exercise.deloaded && (
          <AppText variant="micro" tone="muted">
            Deload work · excluded from 1RM estimates
          </AppText>
        )}
      </Card>
    </>
  );
}
