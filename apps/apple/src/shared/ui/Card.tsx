import { View, type ViewProps } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import type { Tone } from '../theme/theme';

export function Card({
  tone = 'neutral',
  padded = true,
  style,
  ...props
}: ViewProps & { tone?: Tone; padded?: boolean }) {
  const { theme } = useTheme();
  const palette = theme.tones[tone];
  return (
    <View
      {...props}
      style={[
        {
          backgroundColor: tone === 'neutral' ? theme.colors.surface : palette.background,
          borderColor: palette.border,
          borderWidth: 1,
          borderRadius: theme.radii.card,
          overflow: 'hidden',
          padding: padded ? theme.spacing.lg : 0,
          gap: padded ? theme.spacing.md : 0,
        },
        style,
      ]}
    />
  );
}
