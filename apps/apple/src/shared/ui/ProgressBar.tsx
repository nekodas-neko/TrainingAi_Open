import { useReducedMotion } from './useReducedMotion';
import { useEffect, useRef } from 'react';
import { Animated, View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';

export function ProgressBar({
  value,
  complete = false,
  origin = 'left',
  color,
}: {
  value: number;
  complete?: boolean;
  origin?: 'left' | 'right';
  color?: string;
}) {
  const { theme } = useTheme();
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
        height: theme.spacing.sm,
        borderRadius: theme.radii.pill,
        backgroundColor: theme.colors.brandSurface,
        overflow: 'hidden',
      }}
    >
      <Animated.View
        style={{
          height: '100%',
          width: fill.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }),
          backgroundColor: color ?? (complete ? theme.anatomy.main : theme.colors.brand),
          alignSelf: origin === 'right' ? 'flex-end' : 'flex-start',
        }}
      />
    </View>
  );
}
