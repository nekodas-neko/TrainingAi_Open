import { feedback } from '../../integrations/feedback/haptics';
import { useEffect, useRef, useState } from 'react';
import { Animated, Platform, Pressable, View } from 'react-native';
import { useReducedMotion } from './useReducedMotion';
import { useTheme } from '../theme/ThemeProvider';
import { AppText } from './AppText';

export function SegmentedControl<T extends string>({
  label,
  options,
  value,
  onChange,
  animated = false,
  position,
  appearance = 'brand',
  size = 'sm',
}: {
  label: string;
  options: readonly { label: string; value: T }[];
  value: T;
  onChange: (value: T) => void;
  animated?: boolean;
  position?: Animated.AnimatedInterpolation<number>;
  /**
   * 'tabs' is the current app's SegmentedTabs: separate pills, the active one filled in text colour.
   * It ignores `animated` and `position`: the pills swap fill rather than slide a highlight.
   */
  appearance?: 'brand' | 'tabs';
  /** 'tabs' only: the web's size sm (14 px type) or xs (12 px). */
  size?: 'sm' | 'xs';
}) {
  const { theme } = useTheme();
  const [width, setWidth] = useState(0);
  const reduced = useReducedMotion();
  const offset = useRef(new Animated.Value(0)).current;
  const index = Math.max(
    0,
    options.findIndex((option) => option.value === value),
  );
  const cellWidth = Math.max(0, width - theme.spacing.xs * 2) / Math.max(1, options.length);
  const previousWidth = useRef(0);
  useEffect(() => {
    if (position) return;
    const next = index * cellWidth;
    if (!animated || reduced || previousWidth.current !== width) offset.setValue(next);
    else
      Animated.spring(offset, {
        toValue: next,
        speed: 25,
        bounciness: 0,
        useNativeDriver: Platform.OS !== 'web',
      }).start();
    previousWidth.current = width;
    return () => offset.stopAnimation();
  }, [index, cellWidth, width, animated, reduced, offset, position]);
  if (appearance === 'tabs') {
    return (
      <View accessibilityLabel={label} style={{ flexDirection: 'row', gap: theme.spacing.xs }}>
        {options.map((option) => {
          const active = value === option.value;
          return (
            <Pressable
              key={option.value}
              accessibilityRole="radio"
              accessibilityLabel={option.label}
              accessibilityState={{ checked: active }}
              aria-checked={active}
              onPress={() => {
                if (!active) feedback();
                onChange(option.value);
              }}
              style={{
                flex: 1,
                minHeight: theme.sizes.touchTarget,
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: theme.radii.control,
                backgroundColor: active ? theme.colors.text : `${theme.colors.raised}80`,
              }}
            >
              <AppText
                variant={size === 'xs' ? 'caption' : 'subheading'}
                style={{
                  fontWeight: '600',
                  color: active ? theme.colors.background : theme.colors.muted,
                }}
              >
                {option.label}
              </AppText>
            </Pressable>
          );
        })}
      </View>
    );
  }
  return (
    <View
      accessibilityLabel={label}
      onLayout={animated ? (event) => setWidth(event.nativeEvent.layout.width) : undefined}
      style={{
        flexDirection: 'row',
        backgroundColor: theme.colors.raised,
        borderRadius: theme.radii.control,
        overflow: 'hidden',
        padding: theme.spacing.xs,
      }}
    >
      {animated && width > 0 && (
        <Animated.View
          pointerEvents="none"
          style={{
            position: 'absolute',
            top: theme.spacing.xs,
            bottom: theme.spacing.xs,
            left: theme.spacing.xs,
            width: cellWidth,
            borderRadius: theme.radii.small,
            backgroundColor: theme.colors.brandSurface,
            borderWidth: 1,
            borderColor: theme.colors.border,
            transform: [
              {
                translateX: position
                  ? position.interpolate({
                      inputRange: [0, Math.max(1, options.length - 1)],
                      outputRange: [0, cellWidth * Math.max(0, options.length - 1)],
                      extrapolate: 'clamp',
                    })
                  : offset,
              },
            ],
          }}
        />
      )}
      {options.map((option) => (
        <Pressable
          key={option.value}
          accessibilityRole="radio"
          hitSlop={{
            top: (theme.sizes.touchTarget - theme.sizes.control) / 2,
            bottom: (theme.sizes.touchTarget - theme.sizes.control) / 2,
          }}
          accessibilityLabel={option.label}
          accessibilityState={{ checked: value === option.value }}
          aria-checked={value === option.value}
          onPress={() => {
            if (value !== option.value) feedback();
            onChange(option.value);
          }}
          style={{
            flex: 1,
            minHeight: theme.sizes.control,
            paddingVertical: theme.spacing.sm,
            paddingHorizontal: theme.spacing.xs,
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: theme.radii.small,
            backgroundColor:
              !animated && value === option.value ? theme.colors.brandSurface : 'transparent',
          }}
        >
          {/* One line whatever the label: three equal cells leave "Feature Request" about 100 px. */}
          <AppText
            variant="subheading"
            tone={value === option.value ? 'brand' : 'muted'}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.85}
          >
            {option.label}
          </AppText>
        </Pressable>
      ))}
    </View>
  );
}
