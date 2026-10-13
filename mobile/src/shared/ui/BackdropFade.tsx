import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Animated, Platform, StyleSheet, View } from 'react-native';
export function BackdropFade({
  contentKey,
  children,
  animate,
}: {
  contentKey: string;
  children: ReactNode;
  animate: boolean;
}) {
  const latest = useRef(children);
  latest.current = children;
  const shown = useRef({ key: contentKey, node: children });
  const [previous, setPrevious] = useState<ReactNode>(null);
  const opacity = useRef(new Animated.Value(1)).current;
  useLayoutEffect(() => {
    const old = shown.current;
    shown.current = { key: contentKey, node: latest.current };
    if (!animate) {
      opacity.setValue(1);
      setPrevious(null);
      return;
    }
    if (old.key === contentKey) return;
    setPrevious(old.node);
    opacity.setValue(0);
    const transition = Animated.timing(opacity, {
      toValue: 1,
      duration: 800,
      useNativeDriver: Platform.OS !== 'web',
    });
    transition.start(({ finished }) => {
      if (finished) setPrevious(null);
    });
    return () => transition.stop();
  }, [contentKey, animate, opacity]);
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {previous && <View style={StyleSheet.absoluteFill}>{previous}</View>}
      <Animated.View style={[StyleSheet.absoluteFill, { opacity }]}>{children}</Animated.View>
    </View>
  );
}
