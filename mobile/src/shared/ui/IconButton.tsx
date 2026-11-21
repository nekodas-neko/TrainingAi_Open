import { ActivityIndicator } from 'react-native';
import { Pressable } from './Pressable';
import { Icon, type IconName } from './Icon';
import { useTheme } from '../theme/ThemeProvider';
import { slopTo } from './touchSlop';
import type { ReactNode } from 'react';

export function IconButton({
  icon,
  label,
  onPress,
  busy = false,
  disabled = false,
  hint,
  tone = 'muted',
  selected,
  expanded,
  drawnWidth,
  children,
}: {
  icon: IconName;
  label: string;
  onPress?: () => void;
  busy?: boolean;
  disabled?: boolean;
  hint?: string;
  tone?: 'muted' | 'brand' | 'danger';
  selected?: boolean;
  expanded?: boolean;
  /** Draw the button narrower than the touch target; hitSlop keeps the full-width hit area. */
  drawnWidth?: number;
  children?: ReactNode;
}) {
  const { theme } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hint}
      accessibilityState={{ disabled: disabled || !onPress || busy, busy, selected, expanded }}
      disabled={disabled || !onPress || busy}
      onPress={onPress}
      hitSlop={
        drawnWidth === undefined
          ? undefined
          : { left: slopTo(theme.sizes.touchTarget, drawnWidth), right: slopTo(theme.sizes.touchTarget, drawnWidth) }
      }
      style={({ pressed }) => ({
        width: drawnWidth ?? theme.sizes.touchTarget,
        height: theme.sizes.touchTarget,
        borderRadius: theme.radii.control,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: pressed ? theme.colors.raised : 'transparent',
        opacity: disabled ? 0.4 : 1,
      })}
    >
      {busy ? (
        <ActivityIndicator color={theme.colors.muted} />
      ) : (
        (children ?? <Icon name={icon} tone={tone} size={theme.sizes.iconSmall} />)
      )}
    </Pressable>
  );
}
