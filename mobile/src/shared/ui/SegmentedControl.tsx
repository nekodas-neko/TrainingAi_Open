import { feedback } from '../../integrations/feedback/haptics';
import { useEffect, useRef, useState } from 'react';
import { Animated, Platform, Pressable, View } from 'react-native';
import { useReducedMotion } from './useReducedMotion';
import { useTheme } from '../theme/ThemeProvider';
import { AppText } from './AppText';

export function SegmentedControl<T extends string>({
  label,
  options,
  value,
  onChange,
  animated = false,
  position,
}: {
  label: string;
  options: readonly { label: string; value: T }[];
  value: T;
  onChange: (value: T) => void;
  animated?: boolean;
  position?: Animated.AnimatedInterpolation<number>;
}) {
  const { theme } = useTheme();
  const [width, setWidth] = useState(0);
  const reduced = useReducedMotion();
  const offset = useRef(new Animated.Value(0)).current;
  const index = Math.max(
    0,
    options.findIndex((option) => option.value === value),
  );
  const cellWidth = Math.max(0, width - theme.spacing.xs * 2) / Math.max(1, options.length);
  const previousWidth = useRef(0);
  useEffect(() => {
    if (position) return;
    const next = index * cellWidth;
    if (!animated || reduced || previousWidth.current !== width) offset.setValue(next);
    else
      Animated.spring(offset, {
        toValue: next,
        speed: 25,
        bounciness: 0,
        useNativeDriver: Platform.OS !== 'web',
      }).start();
    previousWidth.current = width;
    return () => offset.stopAnimation();
  }, [index, cellWidth, width, animated, reduced, offset, position]);
  return (
    <View
      accessibilityLabel={label}
      onLayout={animated ? (event) => setWidth(event.nativeEvent.layout.width) : undefined}
      style={{
        flexDirection: 'row',
        backgroundColor: theme.colors.raised,
        borderRadius: theme.radii.control,
        overflow: 'hidden',
        padding: theme.spacing.xs,
      }}
    >
      {animated && width > 0 && (
        <Animated.View
          pointerEvents="none"
          style={{
            position: 'absolute',
            top: theme.spacing.xs,
            bottom: theme.spacing.xs,
            left: theme.spacing.xs,
            width: cellWidth,
            borderRadius: theme.radii.small,
            backgroundColor: theme.colors.brandSurface,
            borderWidth: 1,
            borderColor: theme.colors.border,
            transform: [
              {
                translateX: position
                  ? position.interpolate({
                      inputRange: [0, Math.max(1, options.length - 1)],
                      outputRange: [0, cellWidth * Math.max(0, options.length - 1)],
                      extrapolate: 'clamp',
                    })
                  : offset,
              },
            ],
          }}
        />
      )}
      {options.map((option) => (
        <Pressable
          key={option.value}
          accessibilityRole="radio"
          accessibilityLabel={option.label}
          accessibilityState={{ checked: value === option.value }}
          aria-checked={value === option.value}
          onPress={() => {
            if (value !== option.value) feedback();
            onChange(option.value);
          }}
          style={{
            flex: 1,
            minHeight: theme.sizes.touchTarget,
            padding: theme.spacing.sm,
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: theme.radii.small,
            backgroundColor:
              !animated && value === option.value ? theme.colors.brandSurface : 'transparent',
          }}
        >
          <AppText variant="label" tone={value === option.value ? 'brand' : 'muted'}>
            {option.label}
          </AppText>
        </Pressable>
      ))}
    </View>
  );
}
