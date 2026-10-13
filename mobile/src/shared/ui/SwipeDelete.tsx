import { RowGestureContext } from './RowGestureContext';
import { useCallback, useMemo, useRef, useState, type PropsWithChildren } from 'react';
import { Animated, PanResponder, Platform, Pressable, View } from 'react-native';
import { AppText } from './AppText';
import { Icon } from './Icon';
import { useReducedMotion } from './useReducedMotion';
import { useTheme } from '../theme/ThemeProvider';
import { feedback } from '../../integrations/feedback/haptics';
export function SwipeDelete({
  label,
  onDelete,
  onEdit,
  children,
}: PropsWithChildren<{ label: string; onDelete: () => void; onEdit?: () => void }>) {
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
  const actionWidth = theme.sizes.touchTarget * 1.5;
  const width = actionWidth * (onEdit ? 2 : 1);
  const reveal = useCallback(
    (to: number) => {
      currentX.current = to;
      setOpen(to < 0);
      if (reduced) x.setValue(to);
      else
        Animated.spring(x, {
          toValue: to,
          speed: 25,
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
    <View style={{ overflow: 'hidden' }}>
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
        {onEdit && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Edit ${label}`}
            onPress={() => action(onEdit)}
            style={{
              flex: 1,
              backgroundColor: theme.colors.brandSurface,
              alignItems: 'center',
              justifyContent: 'center',
              gap: theme.spacing.xs,
            }}
          >
            <Icon name="edit" tone="brand" size={theme.sizes.iconSmall} />
            <AppText variant="caption" tone="brand">
              Edit
            </AppText>
          </Pressable>
        )}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Delete ${label}`}
          onPress={() => action(onDelete)}
          style={{
            flex: 1,
            backgroundColor: theme.colors.danger,
            alignItems: 'center',
            justifyContent: 'center',
            gap: theme.spacing.xs,
          }}
        >
          <Icon name="delete" color={theme.colors.background} size={theme.sizes.iconSmall} />
          <AppText variant="caption" style={{ color: theme.colors.background }}>
            Delete
          </AppText>
        </Pressable>
      </View>
      <Animated.View
        {...gesture.panHandlers}
        style={{ transform: [{ translateX: x }], backgroundColor: theme.colors.surface }}
      >
        <RowGestureContext.Provider value={interaction}>{children}</RowGestureContext.Provider>
      </Animated.View>
    </View>
  );
}
