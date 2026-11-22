import { AppText, Icon, Pressable, Stack } from '../../../shared/ui';
import { slopTo } from '../../../shared/ui/touchSlop';
import { useTheme } from '../../../shared/theme/ThemeProvider';
import { useCoachLaunch } from '../../coach/CoachProvider';

/**
 * "Change today" on Home's session card (#3896 step 6, owner's pick 8a A): opens the Coach about
 * today's session. One 20 dp line like "Why this?" beside it, with the reach of a full touch target.
 */
export function ChangeTodayButton({ programSessionId }: { programSessionId: string }) {
  const { theme } = useTheme();
  const launch = useCoachLaunch();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Change today's session with the Coach"
      hitSlop={{
        top: slopTo(theme.sizes.touchTarget, theme.sizes.iconSmall),
        bottom: slopTo(theme.sizes.touchTarget, theme.sizes.iconSmall),
        left: theme.spacing.sm,
        right: theme.spacing.sm,
      }}
      onPress={() => launch({ context: { origin: 'session', programSessionId } })}
    >
      <Stack direction="row" align="center" gap="xs">
        <Icon name="coach" size={theme.sizes.iconSmall} tone="brand" />
        <AppText variant="caption" tone="brand">
          Change today
        </AppText>
      </Stack>
    </Pressable>
  );
}
