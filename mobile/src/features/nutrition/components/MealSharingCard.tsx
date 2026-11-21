import { useState } from 'react';
import { AppButton, AppText, Card, LoadingIndicator, Stack, SwitchRow } from '../../../shared/ui';
import { useTheme } from '../../../shared/theme/ThemeProvider';
import { useWorkoutResource } from '../../workouts/data/WorkoutDataProvider';
import {
  isSharing,
  mealSharingFailure,
  mealSharingSpec,
  saveMealSharing,
} from '../data/meal-sharing';

/**
 * Nutrition settings' Sharing card (#2218): whether accepted friends can see and copy the saved
 * meals. Off unless turned on. The switch shows only what the server has said, so while that is not
 * known it shows no position, and a change that does not reach the server leaves it where it was
 * (see `meal-sharing.ts` for why this one is not saved and replayed like other settings).
 */
export function MealSharingCard() {
  const { theme } = useTheme();
  const sharing = useWorkoutResource(mealSharingSpec);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const known = sharing.data !== null;
  async function change(next: boolean) {
    if (!sharing.resources || pending) {
      return;
    }
    setPending(true);
    setFailure(null);
    try {
      await saveMealSharing(sharing.resources, next);
    } catch (cause) {
      setFailure(mealSharingFailure(next, cause));
    } finally {
      setPending(false);
    }
  }
  const label = 'Let friends see and copy my saved meals';
  return (
    <Card>
      <Stack gap="sm">
        <AppText variant="heading">Sharing</AppText>
        {known ? (
          <SwitchRow
            label={label}
            value={isSharing(sharing.data)}
            disabled={pending}
            onValueChange={(next) => void change(next)}
          />
        ) : (
          <Stack
            direction="row"
            align="center"
            justify="space-between"
            gap="lg"
            style={{ minHeight: theme.sizes.touchTarget }}
          >
            <AppText style={{ flex: 1 }}>{label}</AppText>
            {sharing.loading ? (
              <LoadingIndicator accessibilityLabel="Checking this setting" />
            ) : (
              <AppButton title="Retry" variant="ghost" onPress={sharing.refresh} />
            )}
          </Stack>
        )}
        <AppText variant="caption" tone="muted">
          Accepted friends can see each saved meal’s name, ingredients and macros. They can’t see what
          you eat or when, and they only get copies. Off unless you turn it on. Turn it off any time.
        </AppText>
        {!known && !sharing.loading && (
          <AppText variant="caption" tone="muted" accessibilityRole="alert">
            Could not check this setting. It is shown only once your account has confirmed it.
          </AppText>
        )}
        {pending && (
          <AppText variant="caption" tone="muted">
            Saving to your account…
          </AppText>
        )}
        {failure && (
          <AppText variant="caption" tone="danger" accessibilityRole="alert">
            {failure}
          </AppText>
        )}
      </Stack>
    </Card>
  );
}
