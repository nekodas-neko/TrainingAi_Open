import { useId } from 'react';
import { StyleSheet, View, type ViewProps } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { useTheme } from '../theme/ThemeProvider';
import type { Tone } from '../theme/theme';
import { nativeColor } from './ColorSwatches';

export function Card({
  tone = 'neutral',
  padded = true,
  style,
  accent,
  children,
  ...props
}: ViewProps & { tone?: Tone; padded?: boolean; accent?: string }) {
  const { theme } = useTheme();
  const gradientId = useId().replace(/:/g, '');
  const palette = theme.tones[tone];
  const color = nativeColor(accent);
  const tinted = color !== undefined && color !== 'transparent';
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
        // accentCardStyle (packages/shared/src/utils.ts): a translucent muted base (60% dark, 88%
        // light), a 135° wash of the accent from 30% to 12%, and an accent border at 40%.
        color
          ? {
              backgroundColor:
                color === 'transparent'
                  ? 'transparent'
                  : `${theme.colors.raised}${theme.mode === 'light' ? 'e0' : '99'}`,
              borderColor: color === 'transparent' ? theme.colors.border : `${color}66`,
            }
          : undefined,
        style,
      ]}
    >
      {tinted && (
        <View pointerEvents="none" style={StyleSheet.absoluteFill}>
          <Svg width="100%" height="100%">
            <Defs>
              <LinearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
                <Stop offset="0" stopColor={color} stopOpacity="0.3" />
                <Stop offset="1" stopColor={color} stopOpacity="0.12" />
              </LinearGradient>
            </Defs>
            <Rect width="100%" height="100%" fill={`url(#${gradientId})`} />
          </Svg>
        </View>
      )}
      {children}
    </View>
  );
}
