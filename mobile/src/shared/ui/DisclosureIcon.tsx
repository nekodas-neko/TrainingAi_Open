import { useEffect, useRef } from 'react';
import { Animated, Platform } from 'react-native';
import { Icon } from './Icon';
import { useReducedMotion } from './useReducedMotion';
import { useTheme } from '../theme/ThemeProvider';

/** `collapsed="right"` is the current app's ChevronRight that turns to point down when open. */
export function DisclosureIcon({
  expanded,
  size,
  collapsed = 'down',
}: {
  expanded: boolean;
  size?: number;
  collapsed?: 'down' | 'right';
}) {
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
              outputRange: collapsed === 'right' ? ['0deg', '90deg'] : ['0deg', '180deg'],
            }),
          },
        ],
      }}
    >
      <Icon name={collapsed === 'right' ? 'forward' : 'expand'} size={size ?? theme.sizes.iconSmall} tone="muted" />
    </Animated.View>
  );
}
