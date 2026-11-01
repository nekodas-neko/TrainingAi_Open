import { Pressable, View } from 'react-native';
import { AppText, Card, Skeleton, Stack } from '../../../shared/ui';
import { useTheme } from '../../../shared/theme/ThemeProvider';
import { useWorkoutResource } from '../../workouts/data/WorkoutDataProvider';
import { collectionSpec } from '../data/models';
import { cardModel } from '../data/view';
import { CollectionPen } from './CollectionPen';
import { Pips } from './Pips';

/**
 * The collection on Home: a pen of every cat you hold, wandering, over one line about the next
 * merge. Four ladders do not fit a card, so it shows the ladder whose next merge is fewest days away
 * and rotates itself as that changes. The tap goes to the full collection. Off until switched on in
 * the Home layout, like the current app's.
 *
 * Nothing flashes on a repeat visit: the saved answer paints at once and is re-read behind it. A
 * first look with nothing saved holds the pen's place with a placeholder of the same height, and a
 * failed read says so rather than reading as "you have nothing".
 */
export function CollectionCard({
  accent,
  openCollection,
}: {
  accent?: string;
  openCollection: () => void;
}) {
  const { theme } = useTheme();
  const state = useWorkoutResource(collectionSpec);
  const collections = state.data?.v2.collections;
  const model = collections ? cardModel(collections) : null;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Collection. Open your collection"
      onPress={openCollection}
    >
      <Card accent={accent}>
        <AppText variant="cardTitle" tone="muted">
          Collection
        </AppText>
        {!collections || !model ? (
          state.error ? (
            <AppText tone="muted">Couldn’t load your collection.</AppText>
          ) : (
            <Skeleton
              accessibilityLabel="Loading collection"
              style={{ height: theme.sizes.touchTarget - theme.spacing.sm }}
            />
          )
        ) : (
          <>
            <CollectionPen collections={collections} />
            {model.restless && (
              <AppText
                variant="caption"
                tone="brand"
                style={{ fontWeight: '600' }}
              >
                {model.restless}
              </AppText>
            )}
            {model.kind === 'empty' ? (
              <AppText tone="muted">{model.text}</AppText>
            ) : (
              <>
                <Stack direction="row" align="center" gap="md">
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <AppText variant="subheading" numberOfLines={1}>
                      {model.toward}
                    </AppText>
                    <AppText variant="caption" tone="muted">
                      {model.count}
                    </AppText>
                  </View>
                  <Pips have={model.have} need={model.need} shown={model.shown} />
                </Stack>
                {model.note && (
                  <AppText variant="weekTileDelta" tone="muted">
                    {model.note}
                  </AppText>
                )}
              </>
            )}
          </>
        )}
      </Card>
    </Pressable>
  );
}
