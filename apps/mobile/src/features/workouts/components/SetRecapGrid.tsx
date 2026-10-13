import { Pressable, View } from 'react-native';
import { AppText, Card, Stack } from '../../../shared/ui';
import { useTheme } from '../../../shared/theme/ThemeProvider';
import { formatDuration } from '../../../shared/hooks/useClock';
import type { WorkoutExercise } from '../logging/workout';
import { formatSetLoad } from '../logging/targets';

export function SetRecapGrid({
  exercise,
  currentId,
  running,
  onEdit,
}: {
  exercise: WorkoutExercise;
  currentId?: string;
  running: boolean;
  onEdit: (id: string) => void;
}) {
  const { theme } = useTheme();
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.xs }}>
      {exercise.sets.map((set, index) => {
        const done = set.completedAt !== null;
        const current = set.id === currentId;
        return (
          <Pressable
            key={set.id}
            accessibilityRole={done ? 'button' : undefined}
            accessibilityLabel={done ? `Edit recorded set ${index + 1}` : undefined}
            onPress={done ? () => onEdit(set.id) : undefined}
            style={{ width: '49%' }}
          >
            <Card
              tone={done ? 'activity' : current ? 'brand' : 'neutral'}
              style={{
                padding: theme.spacing.sm,
                gap: theme.spacing.xxs,
                opacity: done || current ? 1 : 0.5,
                ...(done
                  ? {
                      backgroundColor: `${theme.anatomy.main}12`,
                      borderColor: `${theme.anatomy.main}29`,
                    }
                  : {}),
              }}
            >
              <Stack direction="row" justify="space-between">
                <AppText variant="micro" tone={done || current ? 'brand' : 'muted'}>
                  {index + 1}
                  {done ? ' ✓' : ''}
                </AppText>
                {done && set.startedAt !== null && (
                  <AppText variant="micro" tone="muted">
                    {formatDuration((set.completedAt! - set.startedAt) / 1000)}
                  </AppText>
                )}
              </Stack>
              <AppText variant="caption">{formatSetLoad(exercise, set)}</AppText>
              <AppText variant="micro" tone="muted">
                {done
                  ? `${set.rpe === null ? '' : `RPE ${set.rpe}${set.rpeSource === 'expected' ? ' expected' : ''}`}${set.restAfterSec === null ? '' : ` · ${set.restAfterSec}s rest`}`
                  : current
                    ? running
                      ? '▶ active'
                      : '↑ up next'
                    : ' '}
              </AppText>
            </Card>
          </Pressable>
        );
      })}
    </View>
  );
}
