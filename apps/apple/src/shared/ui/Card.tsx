import { View, type ViewProps } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import type { Tone } from '../theme/theme';
import { nativeColor } from './ColorSwatches';

export function Card({
  tone = 'neutral',
  padded = true,
  style,
  accent,
  ...props
}: ViewProps & { tone?: Tone; padded?: boolean; accent?: string }) {
  const { theme } = useTheme();
  const palette = theme.tones[tone];
  const color = nativeColor(accent);
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
        color
          ? {
              backgroundColor: color === 'transparent' ? 'transparent' : `${color}18`,
              borderColor: color === 'transparent' ? theme.colors.border : `${color}60`,
            }
          : undefined,
        style,
      ]}
    />
  );
}
