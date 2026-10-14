import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
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
  const scroller = useRef<ScrollView>(null);
  const many = exercise.sets.length > 6;
  const columns = exercise.sets.length <= 4 ? 2 : 3;
  const gap = theme.spacing.sm;
  const [layoutWidth, setLayoutWidth] = useState(0);
  const cardWidth =
    layoutWidth > 0 ? (layoutWidth - (columns - 1) * gap) / columns : undefined;
  const width = theme.sizes.setProgressCard;
  const currentIndex = exercise.sets.findIndex((x) => x.id === currentId);
  useEffect(() => {
    if (many && currentIndex >= 0) {
      scroller.current?.scrollTo({
        x: currentIndex * (width + gap),
        animated: false,
      });
    }
  }, [currentIndex, many, width, gap]);
  return (
    <View onLayout={(event) => setLayoutWidth(event.nativeEvent.layout.width)}>
      <ScrollView
        ref={scroller}
        horizontal={many}
        nestedScrollEnabled
        scrollEnabled={many}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{
          flexDirection: 'row',
          flexWrap: many ? 'nowrap' : 'wrap',
          gap,
        }}
      >
        {exercise.sets.map((set, index) => {
          const done = set.completedAt !== null;
          const current = set.id === currentId;
          return (
            <Pressable
              key={set.id}
              accessibilityRole={done ? 'button' : undefined}
              accessibilityLabel={
                done
                  ? `Edit recorded set ${index + 1}`
                  : `Set ${index + 1}, ${formatSetLoad(exercise, set)}${current ? (running ? ', active' : ', up next') : ''}`
              }
              onPress={done ? () => onEdit(set.id) : undefined}
              style={{
                width: many ? width : cardWidth,
                ...(cardWidth === undefined && !many
                  ? { flexBasis: columns === 2 ? '49%' : '32%' }
                  : {}),
              }}
            >
              <Card
                tone={done ? 'activity' : current ? 'brand' : 'neutral'}
                style={{
                  padding: !many && columns === 3 ? theme.spacing.sm : theme.spacing.md,
                  gap: theme.spacing.xs,
                  ...(done
                    ? {
                        backgroundColor: `${theme.anatomy.main}12`,
                        borderColor: `${theme.anatomy.main}29`,
                      }
                    : {}),
                }}
              >
                <Stack direction="row" justify="space-between" gap="xs">
                  <AppText variant="label" tone={done || current ? 'brand' : 'muted'}>
                    {index + 1}
                    {done ? ' ✓' : current ? (running ? ' Active' : ' Next') : ''}
                  </AppText>
                  {done && set.startedAt !== null && (
                    <AppText variant="caption" tone="muted">
                      {formatDuration((set.completedAt! - set.startedAt) / 1000)}
                    </AppText>
                  )}
                </Stack>
                <AppText
                  variant="body"
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.93}
                >
                  {exercise.exerciseType === 'weighted' || Number(set.weight) !== 0
                    ? formatSetLoad(exercise, set).replace(' reps', '')
                    : formatSetLoad(exercise, set)}
                </AppText>
              </Card>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}
