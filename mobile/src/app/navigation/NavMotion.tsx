import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Animated, Platform, StyleSheet, useWindowDimensions } from 'react-native';
import { MOTION } from '../../shared/ui/motion';
import { RetainedView } from '../../shared/ui/RetainedView';
import { BackLayerContext } from '../../shared/ui/useAndroidBack';
import { useReducedMotion } from '../../shared/ui/useReducedMotion';
import { useTheme } from '../../shared/theme/ThemeProvider';
import type { Entry, Navigation } from './stack';
import { advance, drawn, finish, idle, type Part } from './transition';

/**
 * Screens and tabs that move (#3758). `useNavMotion` follows the navigation and says which layers
 * are moving; `NavLayer` draws one tab or screen and plays its part. The rules are in transition.ts.
 */
type Api = { parts: Record<string, Part>; done: (layer: string) => void };
const NavMotionContext = createContext<Api>({
  parts: {},
  done: () => undefined,
});
export const NavMotionProvider = NavMotionContext.Provider;

/** A moving layer that nothing finished (an unmounted screen) is released after this long. */
const GUARD_MS = 800;

export function useNavMotion(nav: Navigation): { entries: Entry[]; api: Api } {
  const reduced = useReducedMotion();
  const [state, setState] = useState({ seen: nav, motion: idle });
  // Worked out while rendering, so the first frame of a change already holds the screen that is
  // leaving: it is gone from the stack, but still has to slide out.
  let { motion } = state;
  if (state.seen !== nav) {
    motion = advance(state.motion, state.seen, nav, reduced);
    setState({ seen: nav, motion });
  }
  const done = useCallback(
    (layer: string) => setState((value) => ({ ...value, motion: finish(value.motion, layer) })),
    [],
  );
  const moving = Object.keys(motion.parts).length > 0;
  useEffect(() => {
    if (!moving) return;
    const timer = setTimeout(() => setState((value) => ({ ...value, motion: idle })), GUARD_MS);
    return () => clearTimeout(timer);
  }, [moving, motion.seq]);
  const api = useMemo(() => ({ parts: motion.parts, done }), [motion.parts, done]);
  return { entries: drawn(nav, motion), api };
}

/** One tab or screen. `active` is what is showing at rest; a part in a transition keeps it drawn. */
export function NavLayer({
  id,
  active,
  children,
}: {
  id: string;
  active: boolean;
  children: ReactNode;
}) {
  const { parts, done } = useContext(NavMotionContext);
  const part = parts[id];
  const { theme } = useTheme();
  const { width } = useWindowDimensions();
  const progress = useRef(new Animated.Value(1)).current;
  const running = useRef<Animated.CompositeAnimation | null>(null);
  const [mode, setMode] = useState<'rest' | 'slide' | 'fade'>('rest');
  const doneRef = useRef(done);
  doneRef.current = done;
  useLayoutEffect(() => {
    if (!part || part.role === 'under') return;
    const entering = part.role === 'slide-in' || part.role === 'fade-in';
    const slide = part.role === 'slide-in' || part.role === 'slide-out';
    // A layer already moving carries on from where it is, so Back mid-open slides out from there.
    if (entering && !running.current) progress.setValue(0);
    running.current?.stop();
    setMode(slide ? 'slide' : 'fade');
    const timing = slide ? MOTION.screen : MOTION.tabFade;
    const animation = Animated.timing(progress, {
      toValue: entering ? 1 : 0,
      duration: timing.duration,
      ...('easing' in timing ? { easing: timing.easing } : {}),
      useNativeDriver: Platform.OS !== 'web',
    });
    running.current = animation;
    animation.start(({ finished }) => {
      if (running.current !== animation) return;
      running.current = null;
      if (!finished) return;
      setMode('rest');
      doneRef.current(id);
    });
  }, [part, id, progress]);
  useEffect(
    () => () => {
      running.current?.stop();
      running.current = null;
    },
    [],
  );
  const shown = active || !!part;
  const moving = mode !== 'rest' && !!part;
  const style = !moving
    ? styles.fill
    : mode === 'slide'
      ? [
          styles.fill,
          {
            backgroundColor: theme.colors.background,
            transform: [
              {
                translateX: progress.interpolate({
                  inputRange: [0, 1],
                  outputRange: [width, 0],
                }),
              },
            ],
          },
        ]
      : [styles.fill, { opacity: progress }];
  return (
    <Animated.View style={style} pointerEvents={active ? 'auto' : 'none'}>
      <BackLayerContext.Provider value={active}>
        <RetainedView active={active} shown={shown}>
          {children}
        </RetainedView>
      </BackLayerContext.Provider>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  fill: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },
});
