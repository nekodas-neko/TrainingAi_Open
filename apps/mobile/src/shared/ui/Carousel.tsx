import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Animated, Platform, ScrollView, View } from 'react-native';
import { usePagerMotion, type PagerMotion } from './usePagerMotion';
import { useReducedMotion } from './useReducedMotion';
import { feedback } from '../../integrations/feedback/haptics';
import { PageDots } from './PageDots';
import { RetainedView } from './RetainedView';
import { useTheme } from '../theme/ThemeProvider';

export function Carousel<T extends { id: string }>({
  items,
  selectedId,
  onSelect,
  renderItem,
  label,
  showDots = true,
  lazy = false,
  motion: suppliedMotion,
  onApproach,
}: {
  items: readonly T[];
  selectedId: string;
  onSelect: (id: string) => void;
  renderItem: (item: T) => ReactNode;
  label: (item: T) => string;
  showDots?: boolean;
  lazy?: boolean;
  motion?: PagerMotion;
  onApproach?: (id: string) => void;
}) {
  const { theme } = useTheme();
  const ownMotion = usePagerMotion();
  const motion = suppliedMotion ?? ownMotion;
  const { width, setWidth } = motion;
  const reduced = useReducedMotion();
  const currentOffset = useRef(0);
  const target = useRef<number | null>(null);
  const previousWidth = useRef(0);
  const selection = useRef(selectedId);
  selection.current = selectedId;
  const [scrollIndex, setScrollIndex] = useState(() =>
    Math.max(
      0,
      items.findIndex((item) => item.id === selectedId),
    ),
  );
  const scroller = useRef<ScrollView>(null);
  const settle = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (settle.current) {
        clearTimeout(settle.current);
      }
    },
    [],
  );
  const index = Math.max(
    0,
    items.findIndex((item) => item.id === selectedId),
  );
  function commit(nextIndex: number) {
    const item = items[nextIndex];
    if (item && item.id !== selection.current) {
      feedback();
      onSelect(item.id);
    }
  }
  useEffect(() => {
    if (!width) return;
    const resize = previousWidth.current !== width;
    const destination = index * width;
    if (resize) {
      motion.offset.setValue(destination);
      currentOffset.current = destination;
    }
    if (
      resize ||
      (target.current !== index && Math.abs(currentOffset.current - destination) > 1)
    ) {
      target.current = index;
      scroller.current?.scrollTo({ x: destination, animated: !resize && !reduced });
    }
    previousWidth.current = width;
  }, [width, index, reduced, motion.offset]);
  useEffect(() => {
    motion.request.current = (nextIndex) => {
      if (!width) return;
      target.current = nextIndex;
      scroller.current?.scrollTo({ x: nextIndex * width, animated: !reduced });
    };
    return () => {
      motion.request.current = null;
    };
  }, [motion.request, width, reduced]);
  const scroll = Animated.event([{ nativeEvent: { contentOffset: { x: motion.offset } } }], {
    useNativeDriver: Platform.OS !== 'web',
    listener: (event: { nativeEvent: { contentOffset: { x: number } } }) => {
      const x = event.nativeEvent.contentOffset.x;
      currentOffset.current = x;
      const position = x / width;
      const nextIndex = Math.max(0, Math.min(items.length - 1, Math.round(position)));
      if (lazy) setScrollIndex((previous) => (previous === nextIndex ? previous : nextIndex));
      const approaching = items[Math.max(0, Math.min(items.length - 1, Math.ceil(position)))];
      const departing = items[Math.max(0, Math.min(items.length - 1, Math.floor(position)))];
      if (approaching) onApproach?.(approaching.id);
      if (departing) onApproach?.(departing.id);
      if (Platform.OS === 'web') {
        if (settle.current) clearTimeout(settle.current);
        settle.current = setTimeout(() => {
          target.current = nextIndex;
          commit(nextIndex);
        }, 120);
      }
    },
  });
  return (
    <View style={{ flex: 1, minHeight: 0 }}>
      <View
        style={{ flex: 1, minHeight: 0 }}
        onLayout={(event) => {
          const next = event.nativeEvent.layout.width;
          if (next > 0) {
            setWidth(next);
          }
        }}
      >
        {width > 0 && (
          <Animated.ScrollView
            ref={scroller}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            style={{ flex: 1 }}
            contentContainerStyle={{ alignItems: 'stretch' }}
            scrollEventThrottle={16}
            onScrollBeginDrag={() => {
              target.current = null;
            }}
            onScroll={scroll}
            onMomentumScrollEnd={(event) => {
              const nextIndex = Math.round(event.nativeEvent.contentOffset.x / width);
              target.current = nextIndex;
              commit(nextIndex);
            }}
            onScrollEndDrag={(event) => {
              const exact = event.nativeEvent.contentOffset.x / width;
              if (Math.abs(exact - Math.round(exact)) < 0.01) commit(Math.round(exact));
            }}
          >
            {items.map((item, position) => (
              <View
                key={item.id}
                accessibilityElementsHidden={item.id !== selectedId}
                importantForAccessibility={
                  item.id !== selectedId ? 'no-hide-descendants' : 'auto'
                }
                aria-hidden={item.id !== selectedId}
                style={{ width, height: '100%', paddingHorizontal: theme.spacing.lg }}
              >
                {lazy ? (
                  <RetainedView
                    active={
                      Math.abs(position - index) <= 1 ||
                      (scrollIndex !== null && Math.abs(position - scrollIndex) <= 1)
                    }
                  >
                    {renderItem(item)}
                  </RetainedView>
                ) : (
                  renderItem(item)
                )}
              </View>
            ))}
          </Animated.ScrollView>
        )}
      </View>
      {showDots && (
        <PageDots
          labels={items.map(label)}
          selectedIndex={index}
          position={motion.position}
          onSelect={(index) => {
            motion.moveTo(index);
            onSelect(items[index].id);
          }}
        />
      )}
    </View>
  );
}
