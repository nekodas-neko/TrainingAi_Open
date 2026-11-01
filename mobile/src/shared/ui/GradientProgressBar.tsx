import { useId } from 'react';
import { View } from 'react-native';
import Svg, { Defs, LinearGradient, Stop, Rect, Line } from 'react-native-svg';
import { useTheme } from '../theme/ThemeProvider';
import { bandColor } from '../theme/tokens';

// The current app's CalorieProgressBar: a neutral track with the ramp faint along its whole length
// (so green is visible before you reach it), the fill the same ramp at full strength clipped to
// the intake (so its leading edge is the true colour for that position, not the ramp squeezed into
// the fill), and a 1 px notch at the goal.
const TRACK_RAMP_OPACITY = 0.16;
const NOTCH_OPACITY = 0.55;
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
  const notchX = Math.max(0, Math.min(1, notch)) * 1000;
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityValue={{ min: 0, max: 100, now: Math.round(fill * 100) }}
      style={{
        height: theme.spacing.md,
        borderRadius: theme.radii.pill,
        backgroundColor: theme.colors.raised,
        overflow: 'hidden',
      }}
    >
      <Svg width="100%" height="100%" viewBox="0 0 1000 12" preserveAspectRatio="none">
        <Defs>
          {/* userSpaceOnUse: the ramp spans the whole track whatever the fill's width. */}
          <LinearGradient id={id} gradientUnits="userSpaceOnUse" x1="0" x2="1000" y1="0" y2="0">
            {stops.map((stop, i) => (
              <Stop key={i} offset={stop.pct} stopColor={bandColor(stop.color, theme.status)} />
            ))}
          </LinearGradient>
        </Defs>
        <Rect width={1000} height={12} fill={`url(#${id})`} opacity={TRACK_RAMP_OPACITY} />
        <Rect width={1000 * fill} height={12} fill={`url(#${id})`} />
        <Line
          x1={notchX}
          x2={notchX}
          y1={0}
          y2={12}
          stroke={theme.colors.text}
          strokeWidth={3}
          opacity={NOTCH_OPACITY}
        />
      </Svg>
    </View>
  );
}
