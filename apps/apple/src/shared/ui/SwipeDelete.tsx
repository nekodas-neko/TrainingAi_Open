import { useMemo, useRef, type PropsWithChildren } from 'react';
import { Animated, PanResponder, Pressable, View } from 'react-native';
import { AppText } from './AppText';
import { useTheme } from '../theme/ThemeProvider';
export function SwipeDelete({
  label,
  onDelete,
  children,
}: PropsWithChildren<{ label: string; onDelete: () => void }>) {
  const { theme } = useTheme();
  const x = useRef(new Animated.Value(0)).current;
  const width = theme.sizes.touchTarget * 2;
  const gesture = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, g) =>
          g.dx < -15 && Math.abs(g.dx) > Math.abs(g.dy) * 1.5,
        onPanResponderMove: (_, g) => x.setValue(Math.max(-width, Math.min(0, g.dx))),
        onPanResponderRelease: (_, g) =>
          Animated.spring(x, {
            toValue: g.dx < -width / 2 ? -width : 0,
            useNativeDriver: true,
          }).start(),
      }),
    [x, width],
  );
  return (
    <View style={{ overflow: 'hidden' }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Delete ${label}`}
        onPress={onDelete}
        style={{
          position: 'absolute',
          right: 0,
          top: 0,
          bottom: 0,
          width,
          backgroundColor: theme.colors.danger,
          justifyContent: 'center',
          alignItems: 'center',
        }}
      >
        <AppText style={{ color: theme.colors.background }}>Delete</AppText>
      </Pressable>
      <Animated.View
        {...gesture.panHandlers}
        style={{ transform: [{ translateX: x }], backgroundColor: theme.colors.surface }}
      >
        {children}
      </Animated.View>
    </View>
  );
}
