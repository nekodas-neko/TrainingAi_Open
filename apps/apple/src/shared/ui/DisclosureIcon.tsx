import { useEffect, useRef } from 'react';
import { Animated, Platform } from 'react-native';
import { Icon } from './Icon';
import { useReducedMotion } from './useReducedMotion';
import { useTheme } from '../theme/ThemeProvider';

export function DisclosureIcon({ expanded }: { expanded: boolean }) {
  const { theme } = useTheme();
  const reduced = useReducedMotion();
  const rotation = useRef(new Animated.Value(expanded ? 1 : 0)).current;
  useEffect(() => {
    const animation = Animated.timing(rotation, {
      toValue: expanded ? 1 : 0,
      duration: reduced ? 0 : 180,
      useNativeDriver: Platform.OS !== 'web',
    });
    animation.start();
    return () => animation.stop();
  }, [expanded, reduced, rotation]);
  return (
    <Animated.View
      style={{
        transform: [
          {
            rotate: rotation.interpolate({
              inputRange: [0, 1],
              outputRange: ['0deg', '180deg'],
            }),
          },
        ],
      }}
    >
      <Icon name="expand" size={theme.sizes.iconSmall} tone="muted" />
    </Animated.View>
  );
}
