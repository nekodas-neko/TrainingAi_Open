import { useEffect, useRef } from 'react';
import { Animated, Platform, Pressable, type PressableProps } from 'react-native';
import { useReducedMotion } from './useReducedMotion';

export function TouchSurface({
  children,
  style,
  onPressIn,
  onPressOut,
  fill = false,
  ...props
}: PressableProps & { fill?: boolean }) {
  const reduced = useReducedMotion();
  const scale = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (reduced) scale.setValue(1);
    return () => scale.stopAnimation();
  }, [reduced, scale]);
  function animate(value: number) {
    if (!reduced)
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
        style={(state) => [
          { opacity: state.pressed ? 0.8 : 1 },
          typeof style === 'function' ? style(state) : style,
        ]}
      >
        {children}
      </Pressable>
    </Animated.View>
  );
}
