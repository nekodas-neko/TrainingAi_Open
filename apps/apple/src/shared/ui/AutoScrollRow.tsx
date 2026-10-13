import { useEffect, useRef, useState, type PropsWithChildren } from 'react';
import {
  AccessibilityInfo,
  Animated,
  AppState,
  Easing,
  ScrollView,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import type { Space } from '../theme/tokens';
import { useReducedMotion } from './useReducedMotion';

export function AutoScrollRow({
  children,
  active = true,
  label,
  style,
  gap = 'xs',
  pixelsPerSecond = 24,
  pauseDuration = 1800,
  interactionPause = 6000,
}: PropsWithChildren<{
  active?: boolean;
  label: string;
  style?: StyleProp<ViewStyle>;
  gap?: Space;
  pixelsPerSecond?: number;
  pauseDuration?: number;
  interactionPause?: number;
}>) {
  const { theme } = useTheme();
  const reduced = useReducedMotion();
  const [width, setWidth] = useState(0);
  const [contentWidth, setContentWidth] = useState(0);
  const [foreground, setForeground] = useState(AppState.currentState === 'active');
  const [screenReader, setScreenReader] = useState(true);
  const [paused, setPaused] = useState(false);
  const scroll = useRef<ScrollView>(null);
  const offset = useRef(new Animated.Value(0)).current;
  const current = useRef(0);
  const forward = useRef(true);
  const interacting = useRef(false);
  const animation = useRef<Animated.CompositeAnimation | null>(null);
  const resumeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const overflow = Math.max(0, contentWidth - width);

  function clearResume() {
    if (resumeTimer.current) clearTimeout(resumeTimer.current);
    resumeTimer.current = null;
  }
  function hold() {
    if (overflow <= 1) return;
    interacting.current = true;
    clearResume();
    animation.current?.stop();
    setPaused(true);
  }
  function release() {
    if (!interacting.current) return;
    clearResume();
    resumeTimer.current = setTimeout(() => {
      resumeTimer.current = null;
      interacting.current = false;
      setPaused(false);
    }, interactionPause);
  }
  useEffect(() => {
    let mounted = true;
    interacting.current = false;
    setPaused(false);
    setForeground(AppState.currentState === 'active');
    const app = AppState.addEventListener('change', (state) =>
      setForeground(state === 'active'),
    );
    const reader = AccessibilityInfo.addEventListener('screenReaderChanged', setScreenReader);
    void AccessibilityInfo.isScreenReaderEnabled()
      .then((enabled) => {
        if (mounted) setScreenReader(enabled);
      })
      .catch(() => {});
    return () => {
      mounted = false;
      app.remove();
      reader.remove();
      clearResume();
    };
  }, []);
  useEffect(() => {
    if (!active || !foreground) {
      clearResume();
      interacting.current = false;
      setPaused(false);
    }
  }, [active, foreground]);
  useEffect(() => {
    if (!width) return;
    if (overflow <= 1) {
      current.current = 0;
      scroll.current?.scrollTo({ x: 0, animated: false });
      return;
    }
    if (!active || !foreground || reduced || screenReader || paused) return;
    let cancelled = false;
    const listener = offset.addListener(({ value }) => {
      if (interacting.current) return;
      current.current = value;
      scroll.current?.scrollTo({ x: value, animated: false });
    });
    current.current = Math.min(overflow, Math.max(0, current.current));
    offset.setValue(current.current);
    function travel() {
      if (current.current >= overflow - 1) forward.current = false;
      else if (current.current <= 1) forward.current = true;
      const destination = forward.current ? overflow : 0;
      animation.current = Animated.timing(offset, {
        toValue: destination,
        delay: pauseDuration,
        duration: Math.max(
          800,
          (Math.abs(destination - current.current) / Math.max(1, pixelsPerSecond)) * 1000,
        ),
        easing: Easing.linear,
        useNativeDriver: false,
        isInteraction: false,
      });
      animation.current.start(({ finished }) => {
        if (finished && !cancelled) {
          forward.current = !forward.current;
          travel();
        }
      });
    }
    travel();
    return () => {
      cancelled = true;
      animation.current?.stop();
      animation.current = null;
      offset.removeListener(listener);
    };
  }, [
    active,
    foreground,
    reduced,
    screenReader,
    paused,
    width,
    overflow,
    offset,
    pixelsPerSecond,
    pauseDuration,
  ]);
  return (
    <ScrollView
      ref={scroll}
      horizontal
      accessibilityLabel={label}
      showsHorizontalScrollIndicator={false}
      bounces={false}
      directionalLockEnabled
      scrollEnabled={overflow > 1}
      scrollEventThrottle={16}
      style={[{ minWidth: 0 }, style]}
      contentContainerStyle={{ gap: theme.spacing[gap], alignItems: 'center' }}
      onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
      onContentSizeChange={(nextWidth) => setContentWidth(nextWidth)}
      onTouchStart={hold}
      onTouchEnd={release}
      onTouchCancel={release}
      onPointerDown={hold}
      onPointerUp={release}
      onScrollBeginDrag={hold}
      onScrollEndDrag={release}
      onMomentumScrollBegin={hold}
      onMomentumScrollEnd={release}
      onScroll={(event) => {
        if (interacting.current || !animation.current)
          current.current = event.nativeEvent.contentOffset.x;
      }}
    >
      {children}
    </ScrollView>
  );
}
