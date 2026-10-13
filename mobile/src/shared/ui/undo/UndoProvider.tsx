import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useSyncExternalStore,
  type PropsWithChildren,
} from 'react';
import { AccessibilityInfo, Animated, Keyboard, Platform, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { UndoStore, type UndoAction } from './UndoStore';
import { useReducedMotion } from '../useReducedMotion';
import { useTheme } from '../../theme/ThemeProvider';
import { AppText } from '../AppText';
import { AppButton } from '../AppButton';
import { IconButton } from '../IconButton';
import { Card } from '../Card';
import { Stack } from '../Stack';
import { feedback } from '../../../integrations/feedback/haptics';

const Context = createContext<UndoStore | null>(null);
export function useUndo() {
  const store = useContext(Context);
  if (!store) throw new Error('Undo provider missing.');
  return store;
}
export function UndoProvider({ children }: PropsWithChildren) {
  const ref = useRef<UndoStore | null>(null);
  if (!ref.current) ref.current = new UndoStore();
  const store = ref.current;
  useEffect(() => {
    store.resume();
    let active = true;
    void AccessibilityInfo.isScreenReaderEnabled()
      .then((enabled) => {
        if (active) store.setAccessible(enabled);
      })
      .catch(() => {});
    const subscription = AccessibilityInfo.addEventListener(
      'screenReaderChanged',
      store.setAccessible.bind(store),
    );
    return () => {
      active = false;
      subscription.remove();
      store.cancel();
    };
  }, [store]);
  return (
    <Context.Provider value={store}>
      {children}
      <UndoNotice />
    </Context.Provider>
  );
}
export function UndoNotice() {
  const store = useUndo();
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const reduced = useReducedMotion();
  const entrance = useRef(new Animated.Value(0)).current;
  const visible =
    !!state && (state.showNotice !== false || state.phase === 'error' || !!state.error);
  useEffect(() => {
    if (!state || !visible) {
      entrance.setValue(0);
      return;
    }
    if (reduced) entrance.setValue(1);
    else
      Animated.timing(entrance, {
        toValue: 1,
        duration: 180,
        useNativeDriver: Platform.OS !== 'web',
      }).start();
    if (state.phase === 'ready')
      AccessibilityInfo.announceForAccessibility(`${state.label}. Undo available.`);
    return () => entrance.stopAnimation();
  }, [state, visible, reduced, entrance]);
  if (!state || !visible) return null;
  return (
    <View
      pointerEvents="box-none"
      style={{
        position: 'absolute',
        bottom: theme.sizes.navigation + insets.bottom + theme.spacing.md,
        left: theme.spacing.lg,
        right: theme.spacing.lg,
        zIndex: 100,
      }}
    >
      <Animated.View
        style={{
          opacity: entrance,
          transform: [
            {
              translateY: entrance.interpolate({
                inputRange: [0, 1],
                outputRange: [theme.spacing.md, 0],
              }),
            },
          ],
        }}
      >
        <Card style={{ padding: theme.spacing.sm, borderColor: theme.colors.brand }}>
          <Stack direction="row" align="center">
            <AppText variant="caption" accessibilityLiveRegion="polite" style={{ flex: 1 }}>
              {state.error ??
                (state.phase === 'saving'
                  ? 'Saving change…'
                  : state.phase === 'undoing'
                    ? 'Undoing…'
                    : state.label)}
            </AppText>
            {state.phase !== 'error' && (
              <AppButton
                title="Undo"
                variant="ghost"
                busy={state.phase === 'saving' || state.phase === 'undoing'}
                onPress={() => {
                  Keyboard.dismiss();
                  void store.undo().then((ok) => {
                    if (ok) feedback('success');
                  });
                }}
              />
            )}
            <IconButton
              icon="close"
              label="Dismiss notification"
              disabled={state.phase === 'undoing'}
              onPress={() => store.dismiss()}
            />
          </Stack>
        </Card>
      </Animated.View>
    </View>
  );
}
export type { UndoAction };
