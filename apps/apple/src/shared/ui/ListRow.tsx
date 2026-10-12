import type { ReactNode } from 'react';
import { Pressable } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { AppText } from './AppText';
import { Stack } from './Stack';
import { Icon } from './Icon';

export function ListRow({
  title,
  subtitle,
  trailing,
  onPress,
  disabled = !onPress,
  leading,
  density = 'normal',
}: {
  title: string;
  subtitle?: string;
  trailing?: ReactNode;
  onPress?: () => void;
  disabled?: boolean;
  leading?: ReactNode;
  density?: 'normal' | 'compact';
}) {
  const { theme } = useTheme();
  return (
    <Pressable
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={title}
      accessibilityHint={onPress && disabled ? 'Coming soon' : subtitle}
      accessibilityState={onPress ? { disabled } : undefined}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: theme.sizes.touchTarget,
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: density === 'compact' ? theme.spacing.sm : theme.spacing.lg,
        paddingHorizontal: density === 'compact' ? theme.spacing.md : theme.spacing.lg,
        gap: theme.spacing.md,
        borderBottomWidth: 1,
        borderColor: theme.colors.border,
        opacity: pressed ? 0.75 : 1,
      })}
    >
      {leading}
      <Stack gap="xs" style={{ flex: 1 }}>
        <AppText variant="label">{title}</AppText>
        {subtitle && (
          <AppText variant="caption" tone="muted">
            {subtitle}
          </AppText>
        )}
      </Stack>
      {trailing ??
        (!disabled && <Icon name="forward" tone="muted" size={theme.sizes.iconSmall} />)}
    </Pressable>
  );
}
