import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Platform, ScrollView, View } from 'react-native';
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
}: {
  items: readonly T[];
  selectedId: string;
  onSelect: (id: string) => void;
  renderItem: (item: T) => ReactNode;
  label: (item: T) => string;
  showDots?: boolean;
  lazy?: boolean;
}) {
  const { theme } = useTheme();
  const [width, setWidth] = useState(0);
  const [scrollIndex, setScrollIndex] = useState<number | null>(null);
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
  useEffect(() => {
    if (width) {
      scroller.current?.scrollTo({ x: width * index, animated: false });
    }
  }, [width, index]);
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
          <ScrollView
            ref={scroller}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            style={{ flex: 1 }}
            contentContainerStyle={{ alignItems: 'stretch' }}
            contentOffset={{ x: width * index, y: 0 }}
            scrollEventThrottle={16}
            onScroll={(event) => {
              const nextIndex = Math.round(event.nativeEvent.contentOffset.x / width);
              if (lazy) {
                setScrollIndex(nextIndex);
              }
              if (Platform.OS !== 'web') {
                return;
              }
              if (settle.current) {
                clearTimeout(settle.current);
              }
              settle.current = setTimeout(() => {
                const item = items[nextIndex];
                if (item) {
                  onSelect(item.id);
                }
              }, 150);
            }}
            onMomentumScrollEnd={(event) => {
              const item = items[Math.round(event.nativeEvent.contentOffset.x / width)];
              if (item) {
                onSelect(item.id);
              }
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
          </ScrollView>
        )}
      </View>
      {showDots && (
        <PageDots
          labels={items.map(label)}
          selectedIndex={index}
          onSelect={(index) => onSelect(items[index].id)}
        />
      )}
    </View>
  );
}
