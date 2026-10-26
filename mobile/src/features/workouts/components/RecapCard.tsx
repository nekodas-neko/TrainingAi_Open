import { useState } from 'react';
import { View } from 'react-native';
import { AppButton, AppText, Card, Notice, Stack } from '../../../shared/ui';
import { useTheme } from '../../../shared/theme/ThemeProvider';
import { useWorkoutResource } from '../data/WorkoutDataProvider';
import { recapSpec } from '../data/models';

/**
 * The written recap on the done screen. It is written only when asked for (#2111): the stat block
 * above it is the screen, and a recap is a Gemini call, so nothing here fetches until the button is
 * pressed.
 */
export function RecapCard({
  workoutId,
  disabled = false,
}: {
  workoutId: string;
  disabled?: boolean;
}) {
  const [asked, setAsked] = useState(false);
  const { theme } = useTheme();
  const state = useWorkoutResource(recapSpec(workoutId), asked && !disabled);
  const width = { width: '100%' as const, maxWidth: theme.sizes.summaryWidth };
  if (state.data) {
    return (
      <Card style={width}>
        <AppText variant="eyebrow" tone="muted">
          Session recap
        </AppText>
        <AppText>{state.data.recap ?? 'No recap is available yet.'}</AppText>
      </Card>
    );
  }
  const failed = asked && !!state.error;
  return (
    <View style={width}>
      <Stack>
        {failed && <Notice title="Could not write the recap" message={state.error!} />}
        <AppButton
          title={failed ? 'Try again' : 'Write me a recap'}
          variant="secondary"
          busy={asked && state.loading}
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
