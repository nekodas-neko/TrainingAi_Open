import { useEffect } from 'react';
import { View } from 'react-native';
import type { CoachContext } from '@trainingai/shared/coach/context';
import type { CoachChip } from '@trainingai/shared/coach/chips';
import { AppButton, AppText, Card, Skeleton, Stack } from '../../../shared/ui';
import { useTheme } from '../../../shared/theme/ThemeProvider';
import { useWorkoutResource } from '../../workouts/data/WorkoutDataProvider';
import { aboutSpec, type CoachScope } from '../data/models';
import { RENDERED_PATCH_DOMAINS } from '../data/patch';

/**
 * The Coach's context line and buttons (#3896 steps 6-7, owner's pick 8b A). Both come from the
 * server (`/api/coach/about`), which reads them from the user's own rows for the checked context: the
 * app sends only ids, and the buttons it shows are the ones the server chose.
 */
export function useCoachAbout(scope: CoachScope, context: CoachContext | null) {
  return useWorkoutResource(aboutSpec(scope, context, RENDERED_PATCH_DOMAINS));
}

/** "About" over "Cable pulldown · next 3 × 8 @ 50 kg", at the top while the chat is about something. */
export function CoachAboutLine({
  line,
  loading,
}: {
  line: string | null | undefined;
  loading: boolean;
}) {
  const { theme } = useTheme();
  if (!line && !loading) return null;
  return (
    <Card style={{ padding: theme.spacing.md }}>
      <AppText variant="micro" tone="muted">
        About
      </AppText>
      {line ? (
        <AppText variant="label">{line}</AppText>
      ) : (
        // The line's own height, so nothing below moves when it lands.
        <Skeleton style={{ height: theme.typography.label.lineHeight, borderRadius: theme.radii.control }} />
      )}
    </Card>
  );
}

export function CoachChips({
  chips,
  expected,
  disabled,
  error,
  onRetry,
  onPress,
}: {
  chips: readonly CoachChip[] | undefined;
  /** How many placeholders to hold the space with while the buttons load. */
  expected: number;
  disabled: boolean;
  error: string | null;
  onRetry: () => void;
  onPress: (chip: CoachChip) => void;
}) {
  const { theme } = useTheme();
  if (!chips && error)
    return (
      <Stack style={{ alignSelf: 'stretch' }}>
        <AppText variant="caption" tone="danger">
          {error}
        </AppText>
        <AppButton title="Retry" variant="ghost" onPress={onRetry} />
      </Stack>
    );
  return (
    <Stack style={{ alignSelf: 'stretch', paddingTop: theme.spacing.lg }}>
      {chips
        ? chips.map((chip) => (
            <AppButton
              key={chip.id}
              title={chip.label}
              variant="surface"
              disabled={disabled}
              style={{ alignItems: 'flex-start' }}
              onPress={() => onPress(chip)}
            />
          ))
        : Array.from({ length: expected }, (_, i) => (
            <View key={i} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
              <Skeleton style={{ height: theme.sizes.button, borderRadius: theme.radii.control }} />
            </View>
          ))}
    </Stack>
  );
}

/** Taps the button an entry point asked for (the action menu's shortcuts), once it has loaded. */
export function usePendingChip(
  chips: readonly CoachChip[] | undefined,
  pending: string | null,
  ready: boolean,
  take: () => string | null,
  send: (chip: CoachChip) => void,
) {
  useEffect(() => {
    if (!pending || !chips || !ready) return;
    const id = take();
    const chip = chips.find((c) => c.id === id);
    if (chip) send(chip);
  }, [chips, pending, ready, take, send]);
}
