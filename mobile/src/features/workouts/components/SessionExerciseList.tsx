import { plural } from '@trainingai/shared/format/plural';
import { formatDateDisplay } from '@trainingai/shared/date-utils';
import type { ReactNode } from 'react';
import { View } from 'react-native';
import { TouchSurface } from '../../../shared/ui/TouchSurface';
import { AppText, Badge, Card, Stack } from '../../../shared/ui';
import { useTheme } from '../../../shared/theme/ThemeProvider';
import type { ExercisePreview } from '../catalog';
import { ExerciseThumbnail } from './ExerciseHeading';
import { formatSetLoad } from '../logging/targets';
import { weightUnitOf } from '../logging/preferences';
import { useWeightUnits } from '../logging/WorkoutJournalProvider';
import { normalizeMuscle } from '@trainingai/shared/muscles';

export function SessionExerciseList({
  exercises,
  onSelect,
  completedIds = [],
  injuredMuscles = [],
  trailing,
}: {
  exercises: readonly ExercisePreview[];
  onSelect?: (exercise: ExercisePreview) => void;
  completedIds?: string[];
  injuredMuscles?: readonly string[];
  /** A control at the row's end, such as the lift's "…" Coach menu (#3896 step 7). */
  trailing?: (exercise: ExercisePreview) => ReactNode;
}) {
  const { theme } = useTheme();
  const units = useWeightUnits();
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
          <View key={exercise.id}>
            <TouchSurface
              accessibilityRole={onSelect ? 'button' : undefined}
              accessibilityLabel={`${exercise.name}${completed ? ', completed' : ''}`}
              onPress={onSelect ? () => onSelect(exercise) : undefined}
            >
              <Card
                style={{
                  padding: theme.spacing.md,
                  // Room for the trailing control, which sits over the card rather than inside the
                  // row's own touch surface (no control nested in another).
                  ...(trailing && { paddingRight: theme.spacing.md + theme.sizes.touchTarget }),
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
                          {plural(exercise.setCount, 'set', 'sets')}{exercise.style ? ` · ${exercise.style}` : ''}
                        </AppText>
                        <AppText variant="micro" tone="muted">
                          {exercise.lastReps?.length
                            ? `Last: ${exercise.lastReps.map((reps, index) => formatSetLoad({ ...exercise, weightUnit: weightUnitOf(units, exercise.id) }, { weight: String(exercise.lastWeights[index] ?? exercise.lastWeights.at(-1) ?? 0), reps: String(reps) })).join(', ')}${exercise.lastDate ? ` · ${formatDateDisplay(exercise.lastDate, 'short')}` : ''}`
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
                        {injured && <Badge label="Injury" tone="heart" />}
                        {exercise.supersetGroup != null && <Badge label="Superset" />}
                      </Stack>
                    )}
                  </View>
                </Stack>
              </Card>
            </TouchSurface>
            {trailing && (
              <View
                style={{
                  position: 'absolute',
                  top: 0,
                  bottom: 0,
                  right: theme.spacing.xs,
                  justifyContent: 'center',
                }}
              >
                {trailing(exercise)}
              </View>
            )}
          </View>
        );
      })}
    </Stack>
  );
}
