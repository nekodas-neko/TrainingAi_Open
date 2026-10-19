import { useEffect, useRef } from 'react';
import { Animated, Easing, View } from 'react-native';
import { AppText } from '../../../shared/ui';
import { useReducedMotion } from '../../../shared/ui/useReducedMotion';
import { useTheme } from '../../../shared/theme/ThemeProvider';

/** The workout summary's "XP Earned" badge. Absent, not zero, when no gain is known. */
export function WorkoutXp({ xp }: { xp: number | null }) {
  const { theme } = useTheme();
  const reduced = useReducedMotion();
  const pop = useRef(new Animated.Value(0)).current;
  const shown = xp !== null && xp > 0;
  useEffect(() => {
    if (!shown) return;
    if (reduced) {
      pop.setValue(1);
      return;
    }
    // xp-pop: 0.5 s, from 70% size and 8 px low, with the current app's overshoot.
    const animation = Animated.timing(pop, {
      toValue: 1,
      duration: 500,
      easing: Easing.bezier(0.34, 1.56, 0.64, 1),
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [shown, reduced, pop]);
  if (!shown) return null;
  return (
    <Animated.View
      accessible
      accessibilityLabel={`XP earned, ${xp}`}
      style={{
        width: '100%',
        maxWidth: theme.sizes.summaryWidth,
        opacity: pop.interpolate({
          inputRange: [0, 1],
          outputRange: [0, 1],
          extrapolate: 'clamp',
        }),
        transform: [
          {
            scale: pop.interpolate({
              inputRange: [0, 1],
              outputRange: [0.7, 1],
            }),
          },
          {
            translateY: pop.interpolate({
              inputRange: [0, 1],
              outputRange: [theme.spacing.sm, 0],
            }),
          },
        ],
      }}
    >
      <View
        style={{
          alignItems: 'center',
          borderRadius: theme.radii.card,
          borderWidth: 1,
          borderColor: theme.colors.brandBorder,
          backgroundColor: theme.colors.brandSurface,
          paddingHorizontal: theme.spacing.lg,
          paddingVertical: theme.spacing.md,
        }}
      >
        <AppText variant="eyebrow" tone="muted">
          XP Earned
        </AppText>
        <AppText
          variant="hero"
          tone="brand"
          style={{ fontWeight: '900', fontVariant: ['tabular-nums'] }}
        >
          +{xp}
        </AppText>
      </View>
    </Animated.View>
  );
}
