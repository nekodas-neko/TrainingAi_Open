import { useEffect, useRef, useState } from 'react';
import { Animated, Platform, type PressableProps, type PressableStateCallbackType } from 'react-native';
import { Pressable } from './Pressable';
import { dimsOnPress, type PressFeedback } from './pressFeedback';
import { resolveTouchSurfaceStyle } from './touchSurfaceLayout';
import { useReducedMotion } from './useReducedMotion';
import { MOTION } from './motion';

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
  // Only a function style can change its placement keys with the press, so only it tracks it.
  const functionStyle = typeof style === 'function';
  const [pressed, setPressed] = useState(false);
  function animate(value: number) {
    // Releasing always settles back to full size, even if it was disabled mid-press.
    if (!reduced && (value === 1 || dimsOnPress(props)))
      Animated.spring(scale, {
        toValue: value,
        speed: MOTION.springs.press,
        bounciness: 0,
        useNativeDriver: Platform.OS !== 'web',
      }).start();
  }
  // The wrapper is the parent's child, so the caller's placement keys (flex, margins, width,
  // alignSelf) go on it; the Pressable inside fills it and keeps the look (#4067). A function
  // style is split on its resolved result, per press state.
  const outer = resolveTouchSurfaceStyle(style, pressed).outer;
  const innerStyle: PressableProps['style'] = functionStyle
    ? (state: PressableStateCallbackType) => [
        { flexGrow: 1 },
        resolveTouchSurfaceStyle(style, state.pressed).inner,
      ]
    : [{ flexGrow: 1 }, resolveTouchSurfaceStyle(style, false).inner];
  return (
    <Animated.View style={[{ transform: [{ scale }], flexGrow: fill ? 1 : 0 }, outer]}>
      <Pressable
        {...props}
        onPressIn={(event) => {
          animate(0.98);
          if (functionStyle) setPressed(true);
          onPressIn?.(event);
        }}
        onPressOut={(event) => {
          animate(1);
          if (functionStyle) setPressed(false);
          onPressOut?.(event);
        }}
        style={innerStyle}
      >
        {children}
      </Pressable>
    </Animated.View>
  );
}
