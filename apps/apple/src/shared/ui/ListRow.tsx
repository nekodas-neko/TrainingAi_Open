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
}: {
  title: string;
  subtitle?: string;
  trailing?: ReactNode;
  onPress?: () => void;
  disabled?: boolean;
}) {
  const { theme } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityHint={disabled ? 'Coming soon' : subtitle}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: theme.sizes.touchTarget,
        flexDirection: 'row',
        alignItems: 'center',
        padding: theme.spacing.lg,
        gap: theme.spacing.md,
        borderBottomWidth: 1,
        borderColor: theme.colors.border,
        opacity: pressed ? 0.75 : 1,
      })}
    >
      <Stack gap="xs" style={{ flex: 1 }}>
        <AppText variant="label">{title}</AppText>
        {subtitle && (
          <AppText variant="caption" tone="muted">
            {subtitle}
          </AppText>
        )}
      </Stack>
      {trailing ?? (!disabled && <Icon name="forward" tone="muted" size={theme.sizes.iconSmall} />)}
    </Pressable>
  );
}
