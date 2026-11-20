import { useState } from 'react';
import { View } from 'react-native';
import { AppButton, AppText, Card, Notice, Stack } from '../../../shared/ui';
import { useTheme } from '../../../shared/theme/ThemeProvider';
import { useWorkoutResource } from '../data/WorkoutDataProvider';
import { recapSpec } from '../data/models';

/**
 * The written recap on the done screen. It is written only when asked for (#2111): the stat block
 * above it is the screen, so nothing here fetches until the button is
 * pressed.
 *
 * `local`, while the workout's upload is pending (#3880): the recap written from the phone's copy
 * (`localRecap`), shown without asking the server, which doesn't have the workout yet. `null` means
 * the phone couldn't write one, and the button waits for the upload.
 */
export function RecapCard({
  workoutId,
  local,
}: {
  workoutId: string;
  local?: string | null;
}) {
  const [asked, setAsked] = useState(false);
  const { theme } = useTheme();
  const pending = local !== undefined;
  const disabled = local === null;
  const state = useWorkoutResource(recapSpec(workoutId), asked && !pending);
  const width = { width: '100%' as const, maxWidth: theme.sizes.summaryWidth };
  const recap = pending ? (asked ? local : null) : state.data ? (state.data.recap ?? null) : undefined;
  if (recap !== undefined && recap !== null) {
    return (
      <Card style={width}>
        <AppText variant="eyebrow" tone="muted">
          Session recap
        </AppText>
        <AppText>{recap}</AppText>
        {pending && (
          <AppText variant="micro" tone="muted">
            From this phone's copy. The workout hasn't uploaded yet.
          </AppText>
        )}
      </Card>
    );
  }
  if (!pending && state.data) {
    return (
      <Card style={width}>
        <AppText variant="eyebrow" tone="muted">
          Session recap
        </AppText>
        <AppText>No recap is available yet.</AppText>
      </Card>
    );
  }
  const failed = asked && !pending && !!state.error;
  return (
    <View style={width}>
      <Stack>
        {failed && <Notice title="Could not write the recap" message={state.error!} />}
        <AppButton
          title={failed ? 'Try again' : 'Write me a recap'}
          variant="secondary"
          busy={asked && !pending && state.loading}
          disabled={disabled}
          onPress={() => (asked ? state.refresh() : setAsked(true))}
        />
        {disabled && (
          <AppText variant="micro" tone="muted">
            Available after this workout uploads.
          </AppText>
        )}
      </Stack>
    </View>
  );
}
