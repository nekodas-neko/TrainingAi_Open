import { useCallback, useMemo, useRef, useState } from 'react';
import { Animated } from 'react-native';

export function usePagerMotion() {
  const offset = useRef(new Animated.Value(0)).current;
  const [width, setWidth] = useState(0);
  const request = useRef<((index: number) => void) | null>(null);
  const moveTo = useCallback((index: number) => request.current?.(index), []);
  const position = useMemo(
    () =>
      offset.interpolate({
        inputRange: [0, Math.max(1, width)],
        outputRange: [0, 1],
        extrapolate: 'extend',
      }),
    [offset, width],
  );
  return { offset, position, width, setWidth, request, moveTo };
}
export type PagerMotion = ReturnType<typeof usePagerMotion>;
