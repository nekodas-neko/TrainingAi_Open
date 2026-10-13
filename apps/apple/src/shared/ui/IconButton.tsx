import { ActivityIndicator, Pressable } from 'react-native';
import { Icon, type IconName } from './Icon';
import { useTheme } from '../theme/ThemeProvider';
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
      style={({ pressed }) => ({
        width: theme.sizes.touchTarget,
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
