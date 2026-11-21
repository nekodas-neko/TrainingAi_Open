import { AppText, Icon, Stack } from '../../../shared/ui';
import { useTheme } from '../../../shared/theme/ThemeProvider';
import type { RecommendationStrip } from '../data/recommendation-reasons';

/** The one-line "why" over today's card (#3644): amber, orange or red by how strongly the daily
 *  check suggests rest. The pre-workout screen shows the same strip, from the same answer. */
export function DeloadStrip({ strip }: { strip: RecommendationStrip }) {
  const { theme } = useTheme();
  const color = theme.deload[strip.strength];
  return (
    <Stack
      direction="row"
      align="center"
      gap="sm"
      accessibilityRole="text"
      style={{
        borderRadius: theme.radii.control,
        borderWidth: 1,
        borderColor: `${color}40`,
        backgroundColor: `${color}1a`,
        paddingHorizontal: theme.spacing.md,
        paddingVertical: theme.spacing.sm,
      }}
    >
      <Icon name={strip.icon} size={theme.sizes.iconSmall} color={color} />
      <AppText variant="caption" style={{ color, fontWeight: '600', flex: 1 }}>
        {strip.message}
      </AppText>
    </Stack>
  );
}
