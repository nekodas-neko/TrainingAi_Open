import { ReorderScrollView } from './ReorderScrollView';
import { NestedScrollGesture, useNestedScrollBoundary } from './NestedScrollGesture';
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
  type ReactNode,
  type Ref,
} from 'react';
import {
  Animated,
  Easing,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  View,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppText } from './AppText';
import { IconButton } from './IconButton';
import { Stack } from './Stack';
import { useReducedMotion } from './useReducedMotion';
import { useTheme } from '../theme/ThemeProvider';
import { feedback } from '../../integrations/feedback/haptics';

const AnimatedSafeArea = Animated.createAnimatedComponent(SafeAreaView);
export function Sheet({
  visible,
  title,
  onClose,
  children,
  actions,
  footer,
  fullHeight = false,
  scroll = true,
  onDismiss,
  titleColor,
  scrollRef,
}: PropsWithChildren<{
  visible: boolean;
  title: string;
  onClose: () => void;
  actions?: ReactNode;
  footer?: ReactNode;
  fullHeight?: boolean;
  scroll?: boolean;
  onDismiss?: () => void;
  /** The title in this colour instead of the text colour. */
  titleColor?: string;
  /** Reaches the scroll view, to scroll the content to a position. */
  scrollRef?: Ref<ScrollView>;
}>) {
  const { theme } = useTheme();
  const nestedScroll = useNestedScrollBoundary();
  const { height } = useWindowDimensions();
  const reduced = useReducedMotion();
  const [presented, setPresented] = useState(visible);
  const [modalShown, setModalShown] = useState(false);
  const [sheetHeight, setSheetHeight] = useState(0);
  const openingStarted = useRef(false);
  const presentedRef = useRef(presented);
  presentedRef.current = presented;
  const progress = useRef(new Animated.Value(0)).current;
  const dragY = useRef(new Animated.Value(0)).current;
  const closing = useRef(false);
  const dragging = useRef(false);
  const keyboard = useRef(false);
  const scrollY = useRef(0);
  const feltDrag = useRef(false);
  const closeAction = useRef(onClose);
  closeAction.current = onClose;
  const dismissed = useRef(onDismiss);
  dismissed.current = onDismiss;
  const alive = useRef(true);
  const animation = useRef<Animated.CompositeAnimation | null>(null);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      animation.current?.stop();
    };
  }, []);
  useEffect(() => {
    if (!presented) return;
    const willShow = Keyboard.addListener('keyboardWillShow', () => {
      keyboard.current = true;
    });
    const show = Keyboard.addListener('keyboardDidShow', () => {
      keyboard.current = true;
    });
    const hide = Keyboard.addListener('keyboardDidHide', () => {
      keyboard.current = false;
    });
    return () => {
      keyboard.current = false;
      willShow.remove();
      show.remove();
      hide.remove();
    };
  }, [presented]);
  function dismiss(notify = true) {
    if (closing.current) return;
    closing.current = true;
    Keyboard.dismiss();
    animation.current?.stop();
    const finish = () => {
      if (!alive.current) return;
      setPresented(false);
      setModalShown(false);
      if (notify) closeAction.current();
      if (Platform.OS !== 'ios') dismissed.current?.();
    };
    if (reduced) {
      progress.setValue(0);
      finish();
      return;
    }
    animation.current = Animated.timing(progress, {
      toValue: 0,
      duration: 180,
      useNativeDriver: Platform.OS !== 'web',
    });
    animation.current.start(({ finished }) => {
      if (finished) finish();
    });
  }
  const dismissRef = useRef(dismiss);
  dismissRef.current = dismiss;
  useEffect(() => {
    if (!visible && closing.current) {
      return;
    }
    animation.current?.stop();
    if (visible) {
      closing.current = false;
      openingStarted.current = false;
      if (!presentedRef.current) progress.setValue(0);
      setPresented(true);
      dragY.setValue(0);
      scrollY.current = 0;
    } else if (presentedRef.current) dismissRef.current(false);
  }, [visible, reduced, progress, dragY]);
  useEffect(() => {
    if (
      !visible ||
      !presented ||
      !modalShown ||
      sheetHeight <= 0 ||
      closing.current ||
      openingStarted.current
    ) {
      return;
    }
    openingStarted.current = true;
    if (reduced) {
      progress.setValue(1);
      return;
    }
    animation.current = Animated.timing(progress, {
      toValue: 1,
      duration: 240,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: Platform.OS !== 'web',
    });
    animation.current.start();
  }, [visible, presented, modalShown, sheetHeight, reduced, progress]);
  const gestures = useMemo(() => {
    function create(header: boolean, ownStart = false) {
      const canDrag = (_: unknown, g: { dy: number; dx: number }) =>
        !closing.current &&
        !dragging.current &&
        g.dy > 12 &&
        Math.abs(g.dy) > Math.abs(g.dx) * 1.5 &&
        (header ||
          (scroll && !nestedScroll.locked && scrollY.current <= 0 && !keyboard.current));
      return PanResponder.create({
        onStartShouldSetPanResponder: () => ownStart && !dragging.current,
        onMoveShouldSetPanResponderCapture: canDrag,
        onMoveShouldSetPanResponder: canDrag,
        onPanResponderTerminationRequest: () => !dragging.current,
        onPanResponderGrant: () => {
          dragging.current = true;
          dragY.stopAnimation();
          feltDrag.current = false;
        },
        onPanResponderMove: (_, g) => {
          if (g.dy > 12 && !feltDrag.current) {
            feltDrag.current = true;
            feedback('impact');
          }
          dragY.setValue(Math.max(0, g.dy));
        },
        onPanResponderRelease: (_, g) => {
          dragging.current = false;
          if (g.dy > height * 0.13 || (g.dy > 20 && g.vy > 1.1)) dismissRef.current();
          else if (reduced) dragY.setValue(0);
          else
            Animated.spring(dragY, {
              toValue: 0,
              speed: 25,
              bounciness: 0,
              useNativeDriver: Platform.OS !== 'web',
            }).start();
        },
        onPanResponderTerminate: () => {
          dragging.current = false;
          dragY.setValue(0);
        },
      });
    }
    return { body: create(false), header: create(true), handle: create(true, true) };
  }, [dragY, height, reduced, scroll, nestedScroll.locked]);
  const translateY = useMemo(
    () =>
      Animated.add(
        progress.interpolate({
          inputRange: [0, 1],
          outputRange: [sheetHeight || height, 0],
        }),
        dragY,
      ),
    [progress, dragY, sheetHeight, height],
  );
  return (
    <NestedScrollGesture.Provider value={nestedScroll.control}>
      <Modal
        visible={presented}
        transparent
        animationType="none"
        statusBarTranslucent
        onRequestClose={() => dismiss()}
        onShow={() => setModalShown(true)}
        onDismiss={() => dismissed.current?.()}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={{ flex: 1, justifyContent: 'flex-end' }}
        >
          <Animated.View
            pointerEvents="none"
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              backgroundColor: theme.colors.scrim,
              opacity: Animated.multiply(
                progress,
                dragY.interpolate({
                  inputRange: [0, height / 2],
                  outputRange: [1, 0],
                  extrapolate: 'clamp',
                }),
              ),
            }}
          />
          <Pressable accessible={false} onPress={() => dismiss()} style={{ flex: 1 }} />
          <AnimatedSafeArea
            onLayout={(event) => setSheetHeight(event.nativeEvent.layout.height)}
            edges={['bottom']}
            accessibilityViewIsModal
            onAccessibilityEscape={() => dismiss()}
            {...(scroll ? gestures.body.panHandlers : {})}
            style={{
              maxHeight: '85%',
              ...(fullHeight ? { height: '85%' as const } : {}),
              backgroundColor: theme.colors.surface,
              borderTopLeftRadius: theme.radii.card,
              borderTopRightRadius: theme.radii.card,
              paddingHorizontal: theme.spacing.lg,
              paddingBottom: theme.spacing.lg,
              transform: [{ translateY }],
            }}
          >
            <View
              {...gestures.header.panHandlers}
              style={{
                minHeight: theme.spacing.xxl,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <View
                style={{
                  width: theme.sizes.touchTarget,
                  height: theme.spacing.xs,
                  borderRadius: theme.radii.pill,
                  backgroundColor: theme.colors.border,
                }}
              />
            </View>
            <Stack
              {...gestures.header.panHandlers}
              direction="row"
              align="center"
              justify="space-between"
            >
              <AppText
                variant="heading"
                style={[{ flex: 1 }, titleColor ? { color: titleColor } : undefined]}
              >
                {title}
              </AppText>
              {actions}
              <IconButton icon="close" label="Close dialog" onPress={() => dismiss()} />
            </Stack>
            {scroll ? (
              <ReorderScrollView
                scrollEnabled={!nestedScroll.locked}
                scrollRef={scrollRef}
                style={{ flexShrink: 1 }}
                showsVerticalScrollIndicator={false}
                keyboardShouldPersistTaps="handled"
                keyboardDismissMode="interactive"
                scrollEventThrottle={16}
                onScroll={(event) => {
                  scrollY.current = Math.max(0, event.nativeEvent.contentOffset.y);
                }}
                contentContainerStyle={{
                  gap: theme.spacing.md,
                  paddingVertical: theme.spacing.md,
                }}
              >
                {children}
              </ReorderScrollView>
            ) : (
              <View
                style={{
                  flex: 1,
                  minHeight: 0,
                  gap: theme.spacing.md,
                  paddingVertical: theme.spacing.md,
                }}
              >
                {children}
              </View>
            )}
            {footer}
          </AnimatedSafeArea>
        </KeyboardAvoidingView>
      </Modal>
    </NestedScrollGesture.Provider>
  );
}
