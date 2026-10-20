import { View } from 'react-native';
import {
  AppText,
  PageLayout,
  Skeleton,
  Stack,
  StatusIndicator,
} from '../../../shared/ui';
import { useTheme } from '../../../shared/theme/ThemeProvider';
import { useWorkoutResource } from '../../workouts/data/WorkoutDataProvider';
import { collectionSpec } from '../data/models';
import { ladderModels } from '../data/view';
import { CollectionRules } from '../components/CollectionRules';
import { LadderCard } from '../components/LadderCard';

/**
 * The whole collection, and the page that explains it. A repeat visit paints the saved answer at
 * once and re-reads behind it; the skeleton is only for a first look with nothing saved.
 */
export function CollectionScreen({ onBack }: { onBack: () => void }) {
  const { theme } = useTheme();
  const state = useWorkoutResource(collectionSpec);
  const collections = state.data?.v2.collections;
  return (
    <PageLayout
      title="Collection"
      onBack={onBack}
      scroll
      actions={
        <StatusIndicator
          label="Collection"
          busy={state.loading || state.refreshing}
          error={collections ? state.error : null}
          onRetry={state.refresh}
        />
      }
    >
      <Stack gap="md" style={{ paddingHorizontal: theme.spacing.lg }}>
        {!collections && state.error ? (
          <AppText tone="muted">Couldn’t load your collection.</AppText>
        ) : !collections ? (
          <View
            accessibilityLabel="Loading collection"
            accessibilityState={{ busy: true }}
            style={{ gap: theme.spacing.md }}
          >
            {[0, 1, 2, 3].map((i) => (
              <Skeleton
                key={i}
                style={{ height: theme.sizes.actionTile, borderRadius: theme.radii.card }}
              />
            ))}
          </View>
        ) : (
          <>
            {ladderModels(collections).map((ladder) => (
              <LadderCard key={ladder.faucet} ladder={ladder} />
            ))}
            <CollectionRules />
          </>
        )}
      </Stack>
    </PageLayout>
  );
}
