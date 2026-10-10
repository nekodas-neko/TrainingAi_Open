import { View } from 'react-native';
import { AppText } from './AppText';
import { useTheme } from '../theme/ThemeProvider';
import type { Tone } from '../theme/theme';

export function Badge({ label, tone = 'neutral' }: { label: string; tone?: Tone }) {
  const { theme } = useTheme();
  const palette = theme.tones[tone];
  return (
    <View
      style={{
        alignSelf: 'flex-start',
        borderRadius: theme.radii.pill,
        borderWidth: 1,
        borderColor: palette.border,
        backgroundColor: palette.background,
        paddingHorizontal: theme.spacing.sm,
        paddingVertical: theme.spacing.xxs,
      }}
    >
      <AppText variant="caption" style={{ color: palette.foreground }}>
        {label}
      </AppText>
    </View>
  );
}
