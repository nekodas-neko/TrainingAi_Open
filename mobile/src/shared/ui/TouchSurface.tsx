import { useEffect, useRef } from 'react';
import { Animated, Platform, type PressableProps } from 'react-native';
import { Pressable } from './Pressable';
import { dimsOnPress, type PressFeedback } from './pressFeedback';
import { useReducedMotion } from './useReducedMotion';

/**
 * The stronger pressed look for a whole tappable card: it shrinks slightly as well as dimming.
 * The dim is the shared Pressable's; this adds the scale, and only where a press does something.
 */
export function TouchSurface({
  children,
  style,
  onPressIn,
  onPressOut,
  fill = false,
  ...props
}: PressableProps & { fill?: boolean; feedback?: PressFeedback }) {
  const reduced = useReducedMotion();
  const scale = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (reduced) scale.setValue(1);
    return () => scale.stopAnimation();
  }, [reduced, scale]);
  function animate(value: number) {
    // Releasing always settles back to full size, even if it was disabled mid-press.
    if (!reduced && (value === 1 || dimsOnPress(props)))
      Animated.spring(scale, {
        toValue: value,
        speed: 35,
        bounciness: 0,
        useNativeDriver: Platform.OS !== 'web',
      }).start();
  }
  return (
    <Animated.View style={{ transform: [{ scale }], flexGrow: fill ? 1 : 0 }}>
      <Pressable
        {...props}
        onPressIn={(event) => {
          animate(0.98);
          onPressIn?.(event);
        }}
        onPressOut={(event) => {
          animate(1);
          onPressOut?.(event);
        }}
        style={style}
      >
        {children}
      </Pressable>
    </Animated.View>
  );
}
