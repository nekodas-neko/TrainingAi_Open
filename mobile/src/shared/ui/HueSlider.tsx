import { useCallback, useId, useMemo, useRef, useState } from 'react';
import { PanResponder, Platform, View } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { useTheme } from '../theme/ThemeProvider';
import { hueColor } from '../theme/custom-accent';
import { AppText } from './AppText';
import { Stack } from './Stack';

export function HueSlider({
  value,
  onChange,
  onComplete,
  onCancel,
}: {
  value: number | null;
  onChange: (hue: number) => void;
  onComplete: (hue: number) => void;
  onCancel: () => void;
}) {
  const { theme } = useTheme();
  const gradient = useId().replace(/:/g, '');
  const track = useRef<View>(null);
  const [width, setWidth] = useState(0);
  const measuredWidth = useRef(0);
  const startX = useRef(0);
  const pending = useRef(value ?? 180);
  const [dragging, setDragging] = useState(false);
  const callbacks = useRef({ value, onChange, onComplete, onCancel });
  callbacks.current = { value, onChange, onComplete, onCancel };
  const padding = theme.spacing.md;
  const update = useCallback(
    (pageX: number) => {
      const hue = Math.round(
        Math.max(
          0,
          Math.min(
            1,
            (pageX - startX.current - padding) /
              Math.max(1, measuredWidth.current - padding * 2),
          ),
        ) * 360,
      );
      pending.current = hue;
      callbacks.current.onChange(hue);
    },
    [padding],
  );
  const gesture = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: (event) => {
          setDragging(true);
          startX.current = event.nativeEvent.pageX - event.nativeEvent.locationX;
          update(event.nativeEvent.pageX);
        },
        onPanResponderMove: (_, state) => update(state.moveX),
        onPanResponderRelease: () => {
          setDragging(false);
          callbacks.current.onComplete(pending.current);
        },
        onPanResponderTerminate: () => {
          setDragging(false);
          callbacks.current.onCancel();
        },
      }),
    [update],
  );
  return (
    <Stack gap="xs">
      <Stack direction="row" align="center" justify="space-between">
        <AppText variant="label">Custom colour</AppText>
        <AppText variant="caption" tone="muted">
          {value === null ? 'Drag to choose' : theme.colors.brand.toUpperCase()}
        </AppText>
      </Stack>
      <View
        ref={track}
        {...gesture.panHandlers}
        onLayout={(event) => {
          measuredWidth.current = event.nativeEvent.layout.width;
          setWidth(measuredWidth.current);
        }}
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel="Custom accent colour"
        accessibilityHint="Swipe up or down to change the colour hue."
        accessibilityValue={{
          min: 0,
          max: 360,
          now: value ?? 180,
          text: value === null ? 'Using a preset' : `${value} degrees`,
        }}
        accessibilityActions={[
          { name: 'increment', label: 'Next colour' },
          { name: 'decrement', label: 'Previous colour' },
        ]}
        onAccessibilityAction={(event) => {
          const next = Math.max(
            0,
            Math.min(
              360,
              (value ?? 180) + (event.nativeEvent.actionName === 'increment' ? 5 : -5),
            ),
          );
          onComplete(next);
        }}
        style={{
          minHeight: theme.sizes.touchTarget,
          justifyContent: 'center',
          paddingHorizontal: padding,
          ...(Platform.OS === 'web' ? { touchAction: 'none' as const } : {}),
        }}
      >
        <Svg height={theme.sizes.icon} width="100%" pointerEvents="none">
          <Defs>
            <LinearGradient id={gradient} x1="0%" y1="0%" x2="100%" y2="0%">
              {Array.from({ length: 13 }, (_, index) => (
                <Stop
                  key={index}
                  offset={`${(index / 12) * 100}%`}
                  stopColor={hueColor(index * 30)}
                />
              ))}
            </LinearGradient>
          </Defs>
          <Rect
            width="100%"
            height="100%"
            rx={theme.sizes.icon / 2}
            fill={`url(#${gradient})`}
          />
        </Svg>
        {value !== null && (
          <View
            pointerEvents="none"
            style={{
              position: 'absolute',
              left:
                padding +
                (Math.max(0, width - padding * 2) * value) / 360 -
                theme.sizes.iconSmall / 2,
              width: theme.sizes.iconSmall,
              height: dragging
                ? theme.sizes.touchTarget - theme.spacing.sm
                : theme.sizes.touchTarget - theme.spacing.md,
              borderRadius: theme.radii.pill,
              borderWidth: 3,
              borderColor: theme.colors.text,
              backgroundColor: hueColor(value),
              shadowColor: theme.colors.text,
              shadowOpacity: 0.2,
              shadowRadius: 3,
            }}
          />
        )}
      </View>
    </Stack>
  );
}
