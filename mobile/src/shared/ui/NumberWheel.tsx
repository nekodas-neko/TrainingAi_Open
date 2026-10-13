import { useEffect, useMemo, useRef, useState } from 'react';
import { Platform, Pressable, ScrollView, View } from 'react-native';
import { AppText } from './AppText';
import { AppButton } from './AppButton';
import { NumericStepper } from './NumericStepper';
import { Sheet } from './Sheet';
import { useTheme } from '../theme/ThemeProvider';

export function NumberWheel({
  label,
  value,
  onChange,
  min = 0,
  max,
  step = 1,
  disabled = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  min?: number;
  max: number;
  step?: number;
  disabled?: boolean;
}) {
  const { theme } = useTheme();
  const [editing, setEditing] = useState(false);
  const scroller = useRef<ScrollView>(null);
  const moving = useRef(false);
  const interacting = useRef(false);
  const settled = useRef<ReturnType<typeof setTimeout> | null>(null);
  const programmatic = useRef(false);
  const alignment = useRef<ReturnType<typeof setTimeout> | null>(null);
  const offset = useRef(0);
  const selected = value.trim() === '' ? NaN : Number(value);
  const fractionalIndex = (selected - min) / step;
  const offGrid =
    Number.isFinite(selected) &&
    selected >= min &&
    selected <= max &&
    Math.abs(fractionalIndex - Math.round(fractionalIndex)) > 1e-8
      ? selected
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
  const row = theme.sizes.wheelRow;
  const index = Math.max(0, values.indexOf(selected));
  const initialOffset = useRef({ x: 0, y: index * row });
  useEffect(() => {
    if (!moving.current && !editing && Number.isFinite(selected)) {
      programmatic.current = true;
      scroller.current?.scrollTo({ y: index * row, animated: false });
      if (alignment.current) {
        clearTimeout(alignment.current);
      }
      alignment.current = setTimeout(() => {
        programmatic.current = false;
      }, 100);
    }
  }, [index, row, editing, selected]);
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
    const value = values[Math.min(values.length - 1, Math.max(0, Math.round(offset / row)))];
    const text = String(value);
    if (text !== last.current) {
      last.current = text;
      onChange(text);
    }
  }
  function beginInteraction() {
    if (disabled) {
      return;
    }
    programmatic.current = false;
    interacting.current = true;
    moving.current = true;
  }
  return (
    <View style={{ flex: 1, minWidth: 0 }}>
      <View
        accessibilityRole="adjustable"
        accessibilityLabel={label}
        accessibilityValue={{ min, max, now: Number.isFinite(selected) ? selected : undefined }}
        accessibilityState={{ disabled }}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={Number.isFinite(selected) ? selected : undefined}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={(event) => {
          if (disabled) {
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
            left: 0,
            right: 0,
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
          scrollEnabled={!disabled}
          snapToInterval={row}
          decelerationRate="fast"
          showsVerticalScrollIndicator={false}
          contentOffset={initialOffset.current}
          contentContainerStyle={{ paddingVertical: row }}
          scrollEventThrottle={16}
          onTouchStart={() => {
            if (!disabled) {
              programmatic.current = false;
              interacting.current = true;
            }
          }}
          onTouchEnd={() => {
            if (!moving.current) {
              interacting.current = false;
            }
          }}
          {...(Platform.OS === 'web'
            ? { onWheel: beginInteraction, onPointerDown: beginInteraction }
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
              moving.current = false;
              choose(offset.current);
              interacting.current = false;
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
            if (!interacting.current || programmatic.current) {
              return;
            }
            if (settled.current) {
              clearTimeout(settled.current);
            }
            moving.current = false;
            choose(event.nativeEvent.contentOffset.y);
            interacting.current = false;
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
            if (Platform.OS === 'web') {
              moving.current = true;
            }
            if (moving.current) {
              choose(nextOffset);
            }
            if (Platform.OS === 'web') {
              if (settled.current) {
                clearTimeout(settled.current);
              }
              settled.current = setTimeout(() => {
                moving.current = false;
                interacting.current = false;
                scroller.current?.scrollTo({
                  y: Math.round(nextOffset / row) * row,
                  animated: false,
                });
              }, 150);
            }
          }}
        >
          {values.map((number) => (
            <View
              key={number}
              aria-hidden={number !== selected}
              accessibilityElementsHidden={number !== selected}
              importantForAccessibility={number !== selected ? 'no-hide-descendants' : 'auto'}
              style={{ height: row, justifyContent: 'center', alignItems: 'center' }}
            >
              <AppText
                variant={number === selected ? 'wheelValue' : 'pageTitle'}
                tone={number === selected ? 'brand' : 'muted'}
                style={{ opacity: number === selected ? 1 : 0.35 }}
              >
                {number}
              </AppText>
            </View>
          ))}
        </ScrollView>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Edit ${label}`}
        disabled={disabled}
        onPress={() => {
          interacting.current = false;
          moving.current = false;
          if (settled.current) {
            clearTimeout(settled.current);
          }
          setEditing(true);
        }}
        style={{
          minHeight: theme.sizes.touchTarget,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <AppText variant="caption" tone="muted">
          {label} · edit
        </AppText>
      </Pressable>
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
}
