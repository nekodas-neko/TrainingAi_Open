import { View } from 'react-native';
import { AppText, Icon } from '../../../shared/ui';
import { useTheme } from '../../../shared/theme/ThemeProvider';

/**
 * #3671. The current app's "New Personal Record!" pill (`exercise-summary-screen.tsx`): a trophy and
 * the words in amber, where the exercise summary's "Set summary" line otherwise sits.
 */
export function PersonalRecordBadge() {
  const { theme } = useTheme();
  const palette = theme.tones.checkin;
  return (
    <View
      accessibilityRole="text"
      accessibilityLabel="New Personal Record"
      style={{
        alignSelf: 'flex-start',
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.spacing.xxs,
        borderRadius: theme.radii.pill,
        borderWidth: 1,
        borderColor: palette.border,
        backgroundColor: palette.background,
        paddingHorizontal: theme.spacing.sm,
        paddingVertical: theme.spacing.xxs,
      }}
    >
      <Icon name="trophy" size={theme.sizes.iconSmall * 0.6} color={palette.foreground} />
      <AppText variant="micro" style={{ color: palette.foreground, fontWeight: '700' }}>
        New Personal Record!
      </AppText>
    </View>
  );
}
