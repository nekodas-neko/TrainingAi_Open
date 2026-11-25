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
import type { Entry, Navigation } from './stack';
import {
  advance,
  coverOf,
  drawn,
  finish,
  idle,
  layerLook,
  layerOrder,
  startValues,
  touchable,
  type Part,
} from './transition';

/**
 * Screens and tabs that move (#3758). `useNavMotion` follows the navigation and says which layers
 * are moving; `NavLayer` draws one tab or screen and plays its part. The rules are in transition.ts.
 *
 * A sliding screen has no background of its own: screens are transparent over the weather
 * background, so the sky stays visible through the slide. The layer a slide moves over is clipped
 * to what is left of the slide's edge instead, so it never shows through the sliding screen.
 */
type Api = {
  parts: Record<string, Part>;
  /** For each layer, the slide moving over it. */
  covers: Record<string, string>;
  /** Draw order: a layer's place from its stack position. */
  order: Record<string, number>;
  /** A layer's slide position, 0 (off to the right) to 1 (in place). Shared so a layer under a slide can follow it. */
  slide: (layer: string) => Animated.Value;
  done: (layer: string) => void;
};
const resting = new Animated.Value(1);
const NavMotionContext = createContext<Api>({
  parts: {},
  covers: {},
  order: {},
  slide: () => resting,
  done: () => undefined,
});
export const NavMotionProvider = NavMotionContext.Provider;

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
    const timer = setTimeout(
      () => setState((value) => ({ ...value, motion: idle })),
      MOTION.navGuard.duration,
    );
    return () => clearTimeout(timer);
  }, [moving, motion.seq]);
  const slides = useRef(new Map<string, Animated.Value>());
  const slide = useCallback((layer: string) => {
    let value = slides.current.get(layer);
    if (!value) {
      value = new Animated.Value(1);
      slides.current.set(layer, value);
    }
    return value;
  }, []);
  const entries = drawn(nav, motion);
  const live = entries.map((entry) => entry.key).join();
  useEffect(() => {
    // A closed screen's position is not needed again.
    const keep = new Set(live ? live.split(',').map((key) => `entry:${key}`) : []);
    for (const id of slides.current.keys()) {
      if (id.startsWith('entry:') && !keep.has(id)) slides.current.delete(id);
    }
  }, [live]);
  const covers = useMemo(() => coverOf(motion), [motion]);
  const order = useMemo(() => layerOrder(nav, motion), [nav, motion]);
  const api = useMemo(
    () => ({ parts: motion.parts, covers, order, slide, done }),
    [motion.parts, covers, order, slide, done],
  );
  return { entries, api };
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
  const { parts, covers, order, slide: slideOf, done } = useContext(NavMotionContext);
  const part = parts[id];
  const cover = covers[id];
  const { width } = useWindowDimensions();
  const slide = slideOf(id);
  const fade = useRef(new Animated.Value(1)).current;
  const running = useRef<{ animation: Animated.CompositeAnimation; kind: 'slide' | 'fade' } | null>(
    null,
  );
  const doneRef = useRef(done);
  doneRef.current = done;
  // A new part puts an entering layer at its first position while rendering, so the first frame
  // that draws it is already there and not one at rest. Setting an Animated value is safe to repeat.
  const primed = useRef<Part | undefined>(undefined);
  if (part !== primed.current) {
    primed.current = part;
    if (part) {
      const start = startValues(part.role, !running.current);
      if (start.slide !== undefined) slide.setValue(start.slide);
      if (start.fade !== undefined) fade.setValue(start.fade);
    }
  }
  useLayoutEffect(() => {
    if (!part) {
      // Released (landed, or by the guard): nothing of the old motion is left to carry on from.
      running.current?.animation.stop();
      running.current = null;
      return;
    }
    if (part.role === 'under') return;
    const entering = part.role === 'slide-in' || part.role === 'fade-in';
    const slides = part.role === 'slide-in' || part.role === 'slide-out';
    // A layer already moving carries on from where it is, so Back mid-open slides out from there,
    // and a tab chosen mid-slide fades the screen out without moving it.
    const before = running.current;
    before?.animation.stop();
    if (slides && before?.kind === 'fade') fade.setValue(1);
    const timing = slides ? MOTION.screen : MOTION.tabFade;
    const animation = Animated.timing(slides ? slide : fade, {
      toValue: entering ? 1 : 0,
      duration: timing.duration,
      ...('easing' in timing ? { easing: timing.easing } : {}),
      useNativeDriver: Platform.OS !== 'web',
    });
    running.current = { animation, kind: slides ? 'slide' : 'fade' };
    animation.start(({ finished }) => {
      if (running.current?.animation !== animation) return;
      running.current = null;
      if (finished) doneRef.current(id);
    });
  }, [part, id, slide, fade]);
  useEffect(
    () => () => {
      running.current?.animation.stop();
      running.current = null;
    },
    [],
  );
  const look = layerLook(part?.role, !!cover);
  const covering = cover ? slideOf(cover) : null;
  const shown = active || !!part;
  // The outer view fades and clips; the inner one moves. Both are always there, so a layer's
  // screen is never remounted when it starts or stops moving.
  const outer = [
    styles.fill,
    { zIndex: order[id] ?? 0 },
    look.fade ? { opacity: fade } : null,
    covering
      ? {
          overflow: 'hidden' as const,
          transform: [
            { translateX: covering.interpolate({ inputRange: [0, 1], outputRange: [0, -width] }) },
          ],
        }
      : null,
  ];
  const transform = [
    ...(covering
      ? [{ translateX: covering.interpolate({ inputRange: [0, 1], outputRange: [0, width] }) }]
      : []),
    ...(look.slide
      ? [{ translateX: slide.interpolate({ inputRange: [0, 1], outputRange: [width, 0] }) }]
      : []),
  ];
  return (
    <Animated.View style={outer} pointerEvents={touchable(active, part) ? 'auto' : 'none'}>
      <Animated.View style={[styles.fill, transform.length ? { transform } : null]}>
        <BackLayerContext.Provider value={active}>
          <RetainedView active={active} shown={shown}>
            {children}
          </RetainedView>
        </BackLayerContext.Provider>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  fill: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },
});
