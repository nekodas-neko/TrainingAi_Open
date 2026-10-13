import { useId } from 'react';
import { View } from 'react-native';
import Svg, { Defs, LinearGradient, Stop, Rect, Line } from 'react-native-svg';
import { useTheme } from '../theme/ThemeProvider';
export function GradientProgressBar({
  value,
  notch,
  stops,
  label,
}: {
  value: number;
  notch: number;
  stops: readonly { pct: number; color: string }[];
  label: string;
}) {
  const { theme } = useTheme();
  const id = useId().replace(/:/g, '');
  const fill = Math.max(0, Math.min(1, value));
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityValue={{ min: 0, max: 100, now: Math.round(fill * 100) }}
    >
      <Svg
        width="100%"
        height={theme.spacing.md}
        viewBox="0 0 1000 12"
        preserveAspectRatio="none"
      >
        <Defs>
          <LinearGradient id={id} x1="0%" x2="100%">
            {stops.map((stop, i) => (
              <Stop key={i} offset={stop.pct} stopColor={stop.color} />
            ))}
          </LinearGradient>
        </Defs>
        <Rect width={1000} height={12} rx={6} fill={theme.colors.raised} />
        <Rect width={1000 * fill} height={12} rx={6} fill={`url(#${id})`} />
        <Line
          x1={Math.max(0, Math.min(1, notch)) * 1000}
          x2={Math.max(0, Math.min(1, notch)) * 1000}
          y1={0}
          y2={12}
          stroke={theme.colors.text}
          strokeWidth={2}
        />
      </Svg>
    </View>
  );
}
