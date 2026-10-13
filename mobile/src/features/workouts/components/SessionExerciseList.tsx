import { Pressable, View } from 'react-native';
import { AppText, Badge, Card, Stack } from '../../../shared/ui';
import { useTheme } from '../../../shared/theme/ThemeProvider';
import type { ExercisePreview } from '../catalog';
import { ExerciseThumbnail } from './ExerciseHeading';
import { formatSetLoad } from '../logging/targets';
import { normalizeMuscle } from '@trainingai/shared/muscles';

export function SessionExerciseList({
  exercises,
  onSelect,
  completedIds = [],
  injuredMuscles = [],
}: {
  exercises: readonly ExercisePreview[];
  onSelect?: (exercise: ExercisePreview) => void;
  completedIds?: string[];
  injuredMuscles?: readonly string[];
}) {
  const { theme } = useTheme();
  return (
    <Stack gap="sm">
      {exercises.map((exercise, index) => {
        const completed = completedIds.includes(exercise.id);
        const injured = [
          ...exercise.muscles,
          ...(exercise.mainMuscles ?? []),
          ...(exercise.secondaryMuscles ?? []),
        ].some((muscle) => injuredMuscles.includes(normalizeMuscle(muscle)));
        return (
          <Pressable
            key={exercise.id}
            accessibilityRole={onSelect ? 'button' : undefined}
            accessibilityLabel={`${exercise.name}${completed ? ', completed' : ''}`}
            onPress={onSelect ? () => onSelect(exercise) : undefined}
          >
            <Card
              style={{
                padding: theme.spacing.md,
                borderColor: completed ? theme.anatomy.main : theme.colors.border,
              }}
            >
              <Stack direction="row" align="center" gap="sm">
                <AppText variant="micro" tone={completed ? 'brand' : 'muted'}>
                  {completed ? '✓' : index + 1}
                </AppText>
                <ExerciseThumbnail compact name={exercise.name} />
                <View style={{ flex: 1 }}>
                  <AppText variant="label">{exercise.name}</AppText>
                  {onSelect ? (
                    <>
                      <AppText variant="micro" tone="brand">
                        {exercise.setCount} sets{exercise.style ? ` · ${exercise.style}` : ''}
                      </AppText>
                      <AppText variant="micro" tone="muted">
                        {exercise.lastReps?.length
                          ? `Last: ${exercise.lastReps.map((reps, index) => formatSetLoad(exercise, { weight: String(exercise.lastWeights[index] ?? exercise.lastWeights.at(-1) ?? 0), reps: String(reps) })).join(', ')}${exercise.lastDate ? ` · ${exercise.lastDate}` : ''}`
                          : 'No previous data'}
                      </AppText>
                    </>
                  ) : (
                    <AppText variant="micro" tone="brand">
                      {(exercise.mainMuscles?.length
                        ? exercise.mainMuscles
                        : exercise.muscles
                      ).join(', ')}
                    </AppText>
                  )}
                  {exercise.deloaded && <Badge label="Deload" />}
                  {(injured || exercise.supersetGroup != null) && (
                    <Stack direction="row" wrap gap="xs">
                      {injured && <Badge label="Recorded injury" tone="heart" />}
                      {exercise.supersetGroup != null && <Badge label="Superset" />}
                    </Stack>
                  )}
                </View>
              </Stack>
            </Card>
          </Pressable>
        );
      })}
    </Stack>
  );
}
