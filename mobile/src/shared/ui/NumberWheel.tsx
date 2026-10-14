import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform, Pressable, ScrollView, View } from 'react-native';
import { AppText } from './AppText';
import { AppButton } from './AppButton';
import { NumericStepper } from './NumericStepper';
import { Sheet } from './Sheet';
import { useTheme } from '../theme/ThemeProvider';
import { useNestedScrollGesture } from './NestedScrollGesture';

export const NumberWheel = memo(function NumberWheel({
  label,
  value,
  onChange,
  min = 0,
  max,
  step = 1,
  disabled = false,
  rowHeight,
  gesturePaddingStart = 0,
  gesturePaddingEnd = 0,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  min?: number;
  max: number;
  step?: number;
  disabled?: boolean;
  rowHeight?: number;
  gesturePaddingStart?: number;
  gesturePaddingEnd?: number;
}) {
  const { theme } = useTheme();
  const parentScroll = useNestedScrollGesture();
  const [editing, setEditing] = useState(false);
  const [anchor, setAnchor] = useState(value);
  const scroller = useRef<ScrollView>(null);
  const moving = useRef(false);
  const interacting = useRef(false);
  const touching = useRef(false);
  const settled = useRef<ReturnType<typeof setTimeout> | null>(null);
  const programmatic = useRef(false);
  const alignment = useRef<ReturnType<typeof setTimeout> | null>(null);
  const offset = useRef(0);
  const tapped = useRef<number | null>(null);
  const selected = value.trim() === '' ? NaN : Number(value);
  const anchored = anchor.trim() === '' ? NaN : Number(anchor);
  const fractionalIndex = (anchored - min) / step;
  const offGrid =
    Number.isFinite(anchored) &&
    anchored >= min &&
    anchored <= max &&
    Math.abs(fractionalIndex - Math.round(fractionalIndex)) > 1e-8
      ? anchored
      : null;
  const last = useRef(value);
  last.current = value;
  const values = useMemo(() => {
    const values = Array.from(
      { length: Math.floor((max - min) / step) + 1 },
      (_, index) => Math.round((min + index * step) * 100) / 100,
    );
    if (offGrid !== null) {
      values.push(offGrid);
      values.sort((a, b) => a - b);
    }
    return values;
  }, [min, max, step, offGrid]);
  const row = rowHeight ?? theme.sizes.wheelRow;
  const index = Math.max(0, values.indexOf(selected));
  const initialOffset = useRef({ x: 0, y: index * row });
  const alignSelection = useCallback(() => {
    if (
      !moving.current &&
      !interacting.current &&
      !editing &&
      Number.isFinite(selected)
    ) {
      programmatic.current = true;
      offset.current = index * row;
      scroller.current?.scrollTo({ y: index * row, animated: false });
      if (alignment.current) {
        clearTimeout(alignment.current);
      }
      alignment.current = setTimeout(() => {
        programmatic.current = false;
      }, 100);
    }
  }, [index, row, editing, selected]);
  useEffect(() => {
    if (!moving.current && !interacting.current) {
      setAnchor(value);
    }
  }, [value, editing]);
  useEffect(() => {
    alignSelection();
  }, [alignSelection]);
  useEffect(
    () => () => {
      if (settled.current) {
        clearTimeout(settled.current);
      }
      if (alignment.current) {
        clearTimeout(alignment.current);
      }
    },
    [],
  );
  function choose(offset: number) {
    if (!interacting.current || disabled) {
      return;
    }
    const value =
      values[Math.min(values.length - 1, Math.max(0, Math.round(offset / row)))];
    const text = String(value);
    if (text !== last.current) {
      last.current = text;
      onChange(text);
    }
  }
  function finishInteraction(nextOffset: number) {
    if (!interacting.current || programmatic.current || editing) {
      return;
    }
    if (settled.current) {
      clearTimeout(settled.current);
      settled.current = null;
    }
    const target = tapped.current === null ? nextOffset : tapped.current * row;
    choose(target);
    tapped.current = null;
    moving.current = false;
    interacting.current = false;
    parentScroll.end();
    setAnchor(last.current);
    scroller.current?.scrollTo({
      y: Math.round(target / row) * row,
      animated: false,
    });
  }
  function beginInteraction() {
    if (disabled) {
      return;
    }
    programmatic.current = false;
    tapped.current = null;
    interacting.current = true;
    moving.current = true;
    parentScroll.begin();
  }
  function startTouch() {
    if (disabled) return;
    touching.current = true;
    programmatic.current = false;
    interacting.current = true;
    parentScroll.begin();
  }
  function endTouch() {
    touching.current = false;
    if (!moving.current) {
      interacting.current = false;
      parentScroll.end();
    } else if (tapped.current === null) {
      if (settled.current) clearTimeout(settled.current);
      settled.current = setTimeout(() => finishInteraction(offset.current), 200);
    }
  }
  function select(numberIndex: number) {
    if (disabled) return;
    if (settled.current) clearTimeout(settled.current);
    beginInteraction();
    tapped.current = numberIndex;
    choose(numberIndex * row);
    scroller.current?.scrollTo({ y: numberIndex * row, animated: true });
    settled.current = setTimeout(() => finishInteraction(numberIndex * row), 350);
  }
  function openEditor() {
    if (disabled) {
      return;
    }
    interacting.current = false;
    moving.current = false;
    parentScroll.end();
    if (settled.current) {
      clearTimeout(settled.current);
    }
    setEditing(true);
  }
  return (
    <View
      style={{
        flex: 1,
        minWidth: 0,
        marginLeft: -gesturePaddingStart,
        marginRight: -gesturePaddingEnd,
      }}
    >
      <View
        accessibilityRole="adjustable"
        accessibilityLabel={label}
        accessibilityHint="Scroll or tap a neighbouring weight to select it. Double tap the selected weight to enter a value."
        onAccessibilityTap={openEditor}
        accessibilityValue={{
          min,
          max,
          now: Number.isFinite(selected) ? selected : undefined,
        }}
        accessibilityState={{ disabled }}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={Number.isFinite(selected) ? selected : undefined}
        accessibilityActions={[
          { name: 'increment' },
          { name: 'decrement' },
          { name: 'activate', label: 'Enter weight' },
        ]}
        onAccessibilityAction={(event) => {
          if (disabled) {
            return;
          }
          if (event.nativeEvent.actionName === 'activate') {
            openEditor();
            return;
          }
          onChange(
            String(
              Math.min(
                max,
                Math.max(
                  min,
                  (Number.isFinite(selected) ? selected : min) +
                    (event.nativeEvent.actionName === 'increment' ? step : -step),
                ),
              ),
            ),
          );
        }}
        style={{ height: row * 3, overflow: 'hidden' }}
      >
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            left: gesturePaddingStart,
            right: gesturePaddingEnd,
            top: row,
            height: row,
            borderRadius: theme.radii.control,
            borderWidth: 2,
            borderColor: theme.colors.brandBorder,
            backgroundColor: theme.colors.brandSurface,
          }}
        />
        <ScrollView
          ref={scroller}
          nestedScrollEnabled
          bounces={false}
          scrollEnabled={!disabled}
          snapToInterval={row}
          decelerationRate="fast"
          showsVerticalScrollIndicator={false}
          contentOffset={initialOffset.current}
          contentContainerStyle={{ paddingVertical: row }}
          contentInsetAdjustmentBehavior="never"
          automaticallyAdjustContentInsets={false}
          onLayout={alignSelection}
          onContentSizeChange={alignSelection}
          scrollEventThrottle={16}
          onTouchStart={startTouch}
          onTouchEnd={endTouch}
          onTouchCancel={endTouch}
          {...(Platform.OS === 'web'
            ? {
                onWheel: beginInteraction,
                onPointerDown: startTouch,
                onPointerUp: endTouch,
                onPointerCancel: endTouch,
              }
            : {})}
          onScrollBeginDrag={beginInteraction}
          onScrollEndDrag={() => {
            if (!interacting.current) {
              return;
            }
            if (settled.current) {
              clearTimeout(settled.current);
            }
            settled.current = setTimeout(() => {
              finishInteraction(offset.current);
            }, 200);
          }}
          onMomentumScrollBegin={() => {
            if (!interacting.current) {
              return;
            }
            if (settled.current) {
              clearTimeout(settled.current);
            }
            moving.current = true;
          }}
          onMomentumScrollEnd={(event) => {
            finishInteraction(event.nativeEvent.contentOffset.y);
          }}
          onScroll={(event) => {
            const nextOffset = event.nativeEvent.contentOffset.y;
            offset.current = nextOffset;
            if (
              !interacting.current &&
              !editing &&
              Number.isFinite(selected) &&
              Math.abs(nextOffset - index * row) > 1
            ) {
              scroller.current?.scrollTo({ y: index * row, animated: false });
            }
            if (!interacting.current || programmatic.current || editing) {
              return;
            }
            if (tapped.current !== null) return;
            if (Platform.OS === 'web') {
              moving.current = true;
            }
            if (moving.current) {
              choose(nextOffset);
            }
            if (Platform.OS === 'web' || !touching.current) {
              if (settled.current) {
                clearTimeout(settled.current);
              }
              settled.current = setTimeout(() => {
                finishInteraction(nextOffset);
              }, 150);
            }
          }}
        >
          {values.map((number, numberIndex) => {
            const current = numberIndex === index;
            const visible = Math.abs(numberIndex - index) <= 1;
            return (
              <Pressable
                key={number}
                onPress={() => (current ? openEditor() : select(numberIndex))}
                accessibilityRole="button"
                accessibilityLabel={
                  current ? `Enter ${label}` : `Set ${label} to ${number}`
                }
                disabled={disabled}
                aria-hidden={!visible}
                accessibilityElementsHidden={!visible}
                importantForAccessibility={!visible ? 'no-hide-descendants' : 'auto'}
                style={{
                  height: row,
                  justifyContent: 'center',
                  alignItems: 'center',
                  paddingLeft: gesturePaddingStart,
                  paddingRight: gesturePaddingEnd,
                }}
              >
                <AppText
                  variant={current ? 'display' : 'wheelValue'}
                  tone={current ? 'brand' : 'muted'}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.6}
                  style={{
                    opacity: current ? 1 : 0.35,
                    textAlign: 'center',
                    includeFontPadding: false,
                  }}
                >
                  {current && !Number.isFinite(selected) ? '—' : number}
                </AppText>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>
      <Sheet visible={editing} title={label} onClose={() => setEditing(false)}>
        <NumericStepper
          label={label}
          value={value}
          onChange={onChange}
          min={min}
          max={max}
          step={step}
          disabled={disabled}
        />
        <AppButton title="Done" onPress={() => setEditing(false)} />
      </Sheet>
    </View>
  );
});
