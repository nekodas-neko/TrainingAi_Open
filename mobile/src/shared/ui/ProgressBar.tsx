import { useReducedMotion } from './useReducedMotion';
import { useEffect, useId, useRef } from 'react';
import { Animated, View } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { useTheme } from '../theme/ThemeProvider';

export function ProgressBar({
  value,
  complete = false,
  origin = 'left',
  color,
  target,
  height,
  gradient,
  trackColor,
}: {
  value: number;
  complete?: boolean;
  origin?: 'left' | 'right';
  color?: string;
  target?: number;
  /** Track height; the standard bar when omitted. */
  height?: number;
  /**
   * A left-to-right ramp across the filled part, as the current app's `linear-gradient(90deg, …)`
   * fill scaled to the value (its ends are the ramp's ends however full the bar is). Overrides color.
   */
  gradient?: readonly [string, string];
  trackColor?: string;
}) {
  const { theme } = useTheme();
  const gradientId = `bar${useId().replace(/:/g, '')}`;
  const reduced = useReducedMotion();
  const fraction = Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
  const fill = useRef(new Animated.Value(fraction)).current;
  useEffect(() => {
    if (reduced) fill.setValue(fraction);
    else
      Animated.timing(fill, {
        toValue: fraction,
        duration: 240,
        useNativeDriver: false,
      }).start();
    return () => fill.stopAnimation();
  }, [fraction, reduced, fill]);
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityValue={{
        min: 0,
        max: 100,
        now: Math.round(fraction * 100),
      }}
      style={{
        height: height ?? theme.spacing.sm,
        borderRadius: theme.radii.pill,
        backgroundColor: trackColor ?? theme.colors.track,
        overflow: 'hidden',
      }}
    >
      <Animated.View
        style={{
          height: '100%',
          width: fill.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }),
          backgroundColor: gradient
            ? undefined
            : (color ?? (complete ? theme.anatomy.main : theme.colors.brand)),
          borderRadius: gradient ? theme.radii.pill : undefined,
          overflow: gradient ? 'hidden' : undefined,
          alignSelf: origin === 'right' ? 'flex-end' : 'flex-start',
        }}
      >
        {gradient && (
          <Svg width="100%" height="100%" viewBox="0 0 100 1" preserveAspectRatio="none">
            <Defs>
              <LinearGradient id={gradientId} x1="0" x2="1" y1="0" y2="0">
                <Stop offset={0} stopColor={gradient[0]} />
                <Stop offset={1} stopColor={gradient[1]} />
              </LinearGradient>
            </Defs>
            <Rect width={100} height={1} fill={`url(#${gradientId})`} />
          </Svg>
        )}
      </Animated.View>
      {target !== undefined && (
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            top: 0,
            bottom: 0,
            width: theme.spacing.xxs,
            left: `${Math.min(1, Math.max(0, target)) * 100}%`,
            backgroundColor: theme.colors.muted,
          }}
        />
      )}
    </View>
  );
}
