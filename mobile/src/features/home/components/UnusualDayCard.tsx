import { View } from 'react-native';
import { Pressable } from '../../../shared/ui/Pressable';
import { AppText, Card, Stack, StatusIndicator } from '../../../shared/ui';
import { useTheme } from '../../../shared/theme/ThemeProvider';
import { FEEL_OPTIONS, unusualDayCard } from '../data/readiness-prompt';
import { useReadinessQuestion } from '../data/useReadinessQuestion';

/**
 * The unusual-day readiness question, at the top of Home whatever cards are switched on (#3953).
 * Drawn only on a day readiness is outside the user's usual range, until it is answered or
 * dismissed for the day. A dismissal stays on this phone; only an answer is sent.
 */
export function UnusualDayCard() {
  const { theme } = useTheme();
  const { prompt, dismissedToday, busy, error, answer, dismiss } = useReadinessQuestion();
  const ask = unusualDayCard(prompt, dismissedToday);
  if (!ask) {
    return null;
  }
  return (
    <Card tone="checkin">
      <AppText variant="eyebrow" style={{ color: theme.tones.checkin.foreground }}>
        {ask.eyebrow}
      </AppText>
      <AppText variant="heading">{ask.title}</AppText>
      <Stack
        direction="row"
        gap="xs"
        accessibilityRole="radiogroup"
        accessibilityLabel="How you feel compared with usual"
      >
        {FEEL_OPTIONS.map((option) => (
          <Pressable
            key={option.value}
            accessibilityRole="radio"
            accessibilityState={{ checked: false, disabled: busy }}
            disabled={busy}
            onPress={() => void answer(option.value)}
            style={{
              flex: 1,
              minHeight: theme.sizes.touchTarget,
              alignItems: 'center',
              justifyContent: 'center',
              paddingHorizontal: theme.spacing.xs,
              paddingVertical: theme.spacing.xs,
              borderRadius: theme.radii.pill,
              borderWidth: 1,
              borderColor: theme.colors.border,
              backgroundColor: theme.colors.raised,
              opacity: busy ? 0.65 : 1,
            }}
          >
            {/* Three pills share ~103 dp at 384 px: "About the same" wraps rather than clips. */}
            <AppText variant="label" style={{ textAlign: 'center' }}>
              {option.label}
            </AppText>
          </Pressable>
        ))}
      </Stack>
      <Stack direction="row" align="center" justify="space-between">
        <View />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Skip the readiness question for today"
          disabled={busy}
          onPress={() => void dismiss()}
          style={{
            minHeight: theme.sizes.touchTarget,
            minWidth: theme.sizes.touchTarget,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <AppText variant="caption" tone="muted">
            Not now
          </AppText>
        </Pressable>
      </Stack>
      {error && <StatusIndicator label="Readiness question" error={error} />}
    </Card>
  );
}
