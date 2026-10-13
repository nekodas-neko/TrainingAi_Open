import { feedback } from '../../integrations/feedback/haptics';
import { useEffect, useRef, useState } from 'react';
import { Animated, Platform, Pressable, View } from 'react-native';
import { useReducedMotion } from './useReducedMotion';
import { useTheme } from '../theme/ThemeProvider';

export function PageDots({
  labels,
  selectedIndex,
  onSelect,
  variant = 'vertical',
  position: suppliedPosition,
}: {
  labels: readonly string[];
  selectedIndex: number;
  onSelect: (index: number) => void;
  variant?: 'vertical' | 'horizontal';
  position?: Animated.AnimatedInterpolation<number>;
}) {
  const { theme } = useTheme();
  const reduced = useReducedMotion();
  const local = useRef(new Animated.Value(selectedIndex)).current;
  const position = suppliedPosition ?? local;
  const [centers, setCenters] = useState<Record<number, { x: number; y: number }>>({});
  const laidOut = labels.every((_, index) => !!centers[index]);
  const indices = labels.length > 1 ? labels.map((_, index) => index) : [0, 1];
  const dotWidth = variant === 'horizontal' ? theme.spacing.lg : theme.spacing.sm;
  const dotHeight = variant === 'vertical' ? theme.spacing.xl : theme.spacing.sm;
  const cursorX =
    laidOut && labels.length
      ? position.interpolate({
          inputRange: indices,
          outputRange: indices.map(
            (index) => (centers[Math.min(index, labels.length - 1)]?.x ?? 0) - dotWidth / 2,
          ),
          extrapolate: 'clamp',
        })
      : local;
  const cursorY =
    laidOut && labels.length
      ? position.interpolate({
          inputRange: indices,
          outputRange: indices.map(
            (index) => (centers[Math.min(index, labels.length - 1)]?.y ?? 0) - dotHeight / 2,
          ),
          extrapolate: 'clamp',
        })
      : local;
  useEffect(() => {
    if (suppliedPosition) return;
    if (reduced) local.setValue(selectedIndex);
    else
      Animated.spring(local, {
        toValue: selectedIndex,
        speed: 25,
        bounciness: 0,
        useNativeDriver: Platform.OS !== 'web',
      }).start();
    return () => local.stopAnimation();
  }, [selectedIndex, local, reduced, suppliedPosition]);
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'center', flexWrap: 'wrap' }}>
      {labels.map((label, index) => {
        const influence = position.interpolate({
          inputRange: [index - 1, index, index + 1],
          outputRange: [0, 1, 0],
          extrapolate: 'clamp',
        });
        const elongation = influence.interpolate({
          inputRange: [0, 1],
          outputRange: [1, variant === 'vertical' ? 2.5 : 2],
        });
        return (
          <Pressable
            key={index}
            onLayout={(event) => {
              const { x, y, width, height } = event.nativeEvent.layout;
              const next = { x: x + width / 2, y: y + height / 2 };
              setCenters((old) =>
                old[index]?.x === next.x && old[index]?.y === next.y
                  ? old
                  : { ...old, [index]: next },
              );
            }}
            accessibilityRole="button"
            accessibilityLabel={label}
            accessibilityState={{ selected: index === selectedIndex }}
            onPress={() => {
              if (index !== selectedIndex) feedback();
              onSelect(index);
            }}
            style={{
              minWidth: theme.spacing.xxl,
              minHeight: theme.sizes.touchTarget,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <View
              style={{
                width: theme.spacing.sm,
                height: theme.spacing.sm,
                backgroundColor: theme.colors.border,
                borderRadius: theme.radii.pill,
              }}
            />
            {!laidOut && (
              <Animated.View
                style={{
                  position: 'absolute',
                  width: theme.spacing.sm,
                  height: theme.spacing.sm,
                  backgroundColor: theme.colors.brand,
                  borderRadius: theme.radii.pill,
                  opacity: influence,
                  transform: [
                    variant === 'vertical' ? { scaleY: elongation } : { scaleX: elongation },
                  ],
                }}
              />
            )}
          </Pressable>
        );
      })}
      {laidOut && labels.length > 0 && (
        <Animated.View
          pointerEvents="none"
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: dotWidth,
            height: dotHeight,
            backgroundColor: theme.colors.brand,
            borderRadius: theme.radii.pill,
            transform: [{ translateX: cursorX }, { translateY: cursorY }],
          }}
        />
      )}
    </View>
  );
}
