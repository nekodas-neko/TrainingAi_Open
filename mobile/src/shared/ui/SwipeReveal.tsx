import { RowGestureContext } from './RowGestureContext';
import { useCallback, useMemo, useRef, useState, type PropsWithChildren } from 'react';
import { Animated, PanResponder, Platform, Pressable, View } from 'react-native';
import { AppText } from './AppText';
import { Icon, type IconName } from './Icon';
import { useReducedMotion } from './useReducedMotion';
import { MOTION } from './motion';
import { useTheme } from '../theme/ThemeProvider';
import { feedback } from '../../integrations/feedback/haptics';

export type SwipeRevealAction = {
  key: string;
  label: string;
  accessibilityLabel: string;
  icon: IconName;
  foreground: string;
  background: string;
  onPress: () => void;
};

/**
 * A row that slides left to reveal actions behind it, which a second tap runs. Reveal-then-tap,
 * never swipe-to-commit, so an accidental horizontal drag runs nothing. A press inside the row
 * (`ListRow`, `AppButton`) is suppressed while it is dragged or open, and lands on a plain tap.
 * Swipe-to-delete (`SwipeDelete`) and Home's swipe Start to reveal Rest (#2204) both use it.
 */
export function SwipeReveal({
  actions,
  actionWidth,
  rowBackground,
  radius = 0,
  children,
}: PropsWithChildren<{
  actions: SwipeRevealAction[];
  /** Each action's width; a 1.5× touch target by default. */
  actionWidth?: number;
  /** What the sliding row is painted with, so the actions do not show through it. */
  rowBackground?: string;
  radius?: number;
}>) {
  const { theme } = useTheme();
  const reduced = useReducedMotion();
  const x = useRef(new Animated.Value(0)).current;
  const currentX = useRef(0);
  const startX = useRef(0);
  const dragPosition = useRef(0);
  const startPoint = useRef({ x: 0, y: 0 });
  const suppressUntil = useRef(0);
  const moved = useRef(false);
  const [open, setOpen] = useState(false);
  const width = (actionWidth ?? theme.sizes.touchTarget * 1.5) * actions.length;
  const reveal = useCallback(
    (to: number) => {
      currentX.current = to;
      setOpen(to < 0);
      if (reduced) x.setValue(to);
      else
        Animated.spring(x, {
          toValue: to,
          speed: MOTION.springs.swipeReveal,
          bounciness: 0,
          useNativeDriver: Platform.OS !== 'web',
        }).start();
    },
    [reduced, x],
  );
  const gesture = useMemo(() => {
    const shouldSwipe = (event: { nativeEvent: { pageX: number; pageY: number } }) => {
      const dx = event.nativeEvent.pageX - startPoint.current.x;
      const dy = event.nativeEvent.pageY - startPoint.current.y;
      if (Math.abs(dx) > 5 || Math.abs(dy) > 5) moved.current = true;
      return (
        Math.abs(dx) > 15 &&
        Math.abs(dx) > Math.abs(dy) * 1.5 &&
        (dx < 0 || currentX.current < 0)
      );
    };
    return PanResponder.create({
      onStartShouldSetPanResponderCapture: (event) => {
        moved.current = false;
        startPoint.current = { x: event.nativeEvent.pageX, y: event.nativeEvent.pageY };
        return false;
      },
      onMoveShouldSetPanResponderCapture: shouldSwipe,
      onMoveShouldSetPanResponder: shouldSwipe,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => {
        moved.current = true;
        suppressUntil.current = Infinity;
        startX.current = currentX.current;
        dragPosition.current = currentX.current;
        x.stopAnimation((value) => {
          startX.current = value;
        });
      },
      onPanResponderMove: (event) => {
        dragPosition.current = Math.max(
          -width,
          Math.min(0, startX.current + event.nativeEvent.pageX - startPoint.current.x),
        );
        x.setValue(dragPosition.current);
      },
      onPanResponderRelease: () => {
        suppressUntil.current = performance.now() + 120;
        const next = dragPosition.current < -width / 3 ? -width : 0;
        reveal(next);
        if (next) feedback();
      },
      onPanResponderTerminate: () => {
        suppressUntil.current = performance.now() + 120;
        reveal(0);
      },
    });
  }, [x, width, reveal]);
  const interaction = useMemo(
    () => ({
      suppressLongPress: () => moved.current || currentX.current < 0,
      suppressPress: () => {
        if (moved.current) return true;
        if (performance.now() < suppressUntil.current) return true;
        if (currentX.current < 0) {
          reveal(0);
          return true;
        }
        return false;
      },
    }),
    [reveal],
  );
  const action = (callback: () => void) => {
    reveal(0);
    callback();
  };
  return (
    <View style={{ overflow: 'hidden', borderRadius: radius }}>
      <View
        accessibilityElementsHidden={!open}
        importantForAccessibility={!open ? 'no-hide-descendants' : 'auto'}
        aria-hidden={!open}
        style={{
          position: 'absolute',
          right: 0,
          top: 0,
          bottom: 0,
          width,
          flexDirection: 'row',
        }}
      >
        {actions.map((item) => (
          <Pressable
            key={item.key}
            accessibilityRole="button"
            accessibilityLabel={item.accessibilityLabel}
            onPress={() => action(item.onPress)}
            style={{
              flex: 1,
              backgroundColor: item.background,
              alignItems: 'center',
              justifyContent: 'center',
              gap: theme.spacing.xs,
            }}
          >
            <Icon name={item.icon} color={item.foreground} size={theme.sizes.iconSmall} />
            <AppText variant="caption" style={{ color: item.foreground }}>
              {item.label}
            </AppText>
          </Pressable>
        ))}
      </View>
      <Animated.View
        {...gesture.panHandlers}
        style={{
          transform: [{ translateX: x }],
          backgroundColor: rowBackground ?? theme.colors.surface,
        }}
      >
        <RowGestureContext.Provider value={interaction}>{children}</RowGestureContext.Provider>
      </Animated.View>
    </View>
  );
}
