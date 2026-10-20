import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, AppState, Easing, StyleSheet, View } from 'react-native';
import { SvgXml } from 'react-native-svg';
import type { CollectionState } from '@trainingai/shared/collection/ladder';
import {
  ASSUMED_PEN_W,
  PEN_HEIGHT,
  penCatMotion,
  penCats,
  shownForWidth,
  slotOf,
  tagsForWidth,
  type PenCat,
  type PenMotion,
} from '@trainingai/shared/collection/pen';
import type { FaucetKey } from '@trainingai/shared/collection/summary';
import { AppText } from '../../../shared/ui';
import { useReducedMotion } from '../../../shared/ui/useReducedMotion';
import { useTheme } from '../../../shared/theme/ThemeProvider';
import { catArt } from '../art';
import { CatSprite } from './CatSprite';

/** Ease in and out, as the web's walk does. */
const smooth = (u: number) => (u < 0.5 ? 2 * u * u : 1 - 2 * (1 - u) * (1 - u));
/** ta-pen-walk: idle for the first 12% and last 12% of a leg, walking in between. */
const leg = (t: number) => (t <= 0.12 ? 0 : t >= 0.88 ? 1 : smooth((t - 0.12) / 0.76));
const STEPS = 24;
/** A walk is out and back: clock 0 to 1 is the way out, 1 to 2 the way back. */
const CLOCK_IN = Array.from({ length: 2 * STEPS + 1 }, (_, k) => k / STEPS);
const walk = (a: number, b: number) =>
  CLOCK_IN.map((c) => a + (b - a) * (c <= 1 ? leg(c) : 1 - leg(c - 1)));

function useAppActive() {
  const [active, setActive] = useState(AppState.currentState === 'active');
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) =>
      setActive(state === 'active'),
    );
    return () => subscription.remove();
  }, []);
  return active;
}

/** Runs `value` round its cycle while `running`, and holds still otherwise. */
function useCycle(value: Animated.Value, cycle: number, running: boolean, to: number) {
  useEffect(() => {
    if (!running) return;
    let stopped = false;
    const run = (from: number) => {
      if (stopped) return;
      value.setValue(from);
      Animated.timing(value, {
        toValue: to,
        duration: Math.max(1, ((to - from) / to) * cycle * 1000),
        easing: Easing.linear,
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (finished && !stopped) run(0);
      });
    };
    value.stopAnimation((now) => run(now >= to ? 0 : now));
    return () => {
      stopped = true;
      value.stopAnimation();
    };
  }, [value, cycle, running, to]);
}

function PenCatView({
  cat,
  motion,
  penW,
  tag,
  running,
  still,
}: {
  cat: PenCat;
  motion: PenMotion;
  penW: number;
  tag: string | null;
  running: boolean;
  /** Reduced motion: stand where the walk starts, as the web does. */
  still: boolean;
}) {
  const { theme } = useTheme();
  const { size, flying } = motion;
  const clock = useRef(new Animated.Value(motion.offset / motion.dur)).current;
  const bob = useRef(new Animated.Value(0)).current;
  // The walk is out and back over two legs of `dur` seconds each.
  useCycle(clock, motion.dur * 2, running, 2);
  useCycle(bob, 2.6, running && flying, 1);
  useEffect(() => {
    if (still) clock.setValue(0);
  }, [still, clock]);
  const free = Math.max(0, penW - size);
  const translateX = useMemo(
    () =>
      clock.interpolate({
        inputRange: CLOCK_IN,
        outputRange: walk(motion.from * free, motion.to * free),
      }),
    [clock, motion.from, motion.to, free],
  );
  const translateY = useMemo(
    () =>
      clock.interpolate({
        inputRange: CLOCK_IN,
        outputRange: walk(-motion.y0, -motion.y1),
      }),
    [clock, motion.y0, motion.y1],
  );
  // The cat turns round exactly when the walk does.
  const face = clock.interpolate({
    inputRange: [0, 0.999, 1, 2],
    outputRange: [1, 1, -1, -1],
  });
  const lift = bob.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0, -6, 0] });
  return (
    <Animated.View
      style={{
        position: 'absolute',
        left: 0,
        bottom: 0,
        width: size,
        zIndex: motion.zIndex,
        transform: [{ translateX }, { translateY }],
      }}
    >
      {/* Ground shadow: under the feet for walkers, far below and fainter for flyers. */}
      <View
        style={{
          position: 'absolute',
          alignSelf: 'center',
          width: size * 0.7,
          height: size * 0.14,
          bottom: flying ? -34 : -2,
          borderRadius: theme.radii.pill,
          backgroundColor: theme.colors.scrim,
          opacity: flying ? 0.22 : 0.4,
        }}
      />
      <Animated.View style={{ transform: [{ translateY: lift }] }}>
        <Animated.View style={{ transform: [{ scaleX: face }] }}>
          <CatSprite faucet={cat.faucet} tier={cat.tier} size={size} />
        </Animated.View>
      </Animated.View>
      {tag && (
        <View
          style={{
            position: 'absolute',
            top: '100%',
            alignSelf: 'center',
            borderRadius: theme.radii.small / 2,
            backgroundColor: theme.colors.background,
            paddingHorizontal: theme.spacing.xs,
            opacity: 0.8,
          }}
        >
          <AppText variant="statUnit" numberOfLines={1} style={{ fontWeight: '600' }}>
            {tag}
          </AppText>
        </View>
      )}
    </Animated.View>
  );
}

/**
 * The collection as a pen of cats wandering about, for the Home card: the cats the pen's measured
 * width fits, spread across tiers, with a name tag on the rarest few. Depth follows tier (small
 * cats near and low, big ones further back and higher, the top two in the air). Positions are seeded
 * from each cat's identity, so a re-read that returns the same stock does not reshuffle the pen.
 *
 * Under reduced motion the cats stand where their walks start. They also stand still while the app
 * is in the background, and a hidden tab unmounts the effects that move them.
 */
export const CollectionPen = memo(function CollectionPen({
  collections,
}: {
  collections: Partial<Record<FaucetKey, CollectionState>>;
}) {
  const { theme } = useTheme();
  const reduced = useReducedMotion();
  const appActive = useAppActive();
  const [penW, setPenW] = useState(ASSUMED_PEN_W);
  const { shown, total } = useMemo(
    () => penCats(collections, shownForWidth(penW)),
    [collections, penW],
  );
  const tags = tagsForWidth(penW);
  if (total === 0) return null;
  return (
    <View
      onLayout={(event) => {
        const width = Math.round(event.nativeEvent.layout.width);
        setPenW((previous) => (previous === width || width === 0 ? previous : width));
      }}
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
      style={{
        height: PEN_HEIGHT,
        borderRadius: theme.radii.control,
        overflow: 'hidden',
        backgroundColor: theme.colors.raised,
      }}
    >
      <SvgXml
        xml={catArt['scene-meadow']}
        width="100%"
        height="100%"
        style={StyleSheet.absoluteFill}
      />
      {shown.map((cat, i) => (
        <PenCatView
          key={cat.id}
          cat={cat}
          motion={penCatMotion(cat, slotOf(i, shown.length), shown.length)}
          penW={penW}
          tag={cat.name && i < tags ? cat.name : null}
          running={!reduced && appActive}
          still={reduced}
        />
      ))}
      {total > shown.length && (
        <AppText
          variant="micro"
          style={{
            position: 'absolute',
            right: theme.spacing.sm + theme.spacing.xxs,
            top: theme.spacing.sm,
            color: theme.colors.onSignal,
            opacity: 0.75,
            textShadowColor: theme.colors.scrim,
            textShadowOffset: { width: 0, height: 1 },
            textShadowRadius: 2,
          }}
        >
          +{total - shown.length} more
        </AppText>
      )}
    </View>
  );
});
