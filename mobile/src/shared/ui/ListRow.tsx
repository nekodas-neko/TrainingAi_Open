import { RowGestureContext } from './RowGestureContext';
import { useContext, type ReactNode } from 'react';
import { Pressable, View, type ViewStyle } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { AppText } from './AppText';
import { Stack } from './Stack';
import { Icon } from './Icon';

export function ListRow({
  title,
  titleTone,
  subtitle,
  subtitleColor,
  warning,
  trailing,
  onPress,
  onLongPress,
  disabled = !onPress,
  leading,
  density = 'normal',
  divider = true,
  checked,
}: {
  title: string;
  /** 'danger' draws the title red, for a destructive row. */
  titleTone?: 'danger';
  subtitle?: string;
  subtitleColor?: string;
  /** An amber caution line under the subtitle, with an icon so it is not colour alone. */
  warning?: string;
  trailing?: ReactNode;
  onPress?: () => void;
  onLongPress?: () => void;
  disabled?: boolean;
  leading?: ReactNode;
  /** 'normal' and 'snug' are the current app's py-3 px-4 row; 'compact' is tighter. */
  density?: 'normal' | 'snug' | 'compact';
  divider?: boolean;
  checked?: boolean;
}) {
  const { theme } = useTheme();
  const gesture = useContext(RowGestureContext);
  const rowStyle: ViewStyle = {
    minHeight: theme.sizes.touchTarget,
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical:
      density === 'compact' ? theme.spacing.sm : theme.spacing.md,
    paddingHorizontal: density === 'compact' ? theme.spacing.md : theme.spacing.lg,
    gap: theme.spacing.md,
    borderBottomWidth: divider ? 1 : 0,
    borderColor: theme.colors.border,
  };
  const content = (
    <>
      {leading}
      <Stack gap="xs" style={{ flex: 1 }}>
        <AppText variant="label" tone={titleTone}>
          {title}
        </AppText>
        {subtitle && (
          <AppText
            variant="caption"
            tone="muted"
            style={subtitleColor ? { color: subtitleColor } : undefined}
          >
            {subtitle}
          </AppText>
        )}
        {warning && (
          <Stack direction="row" gap="xs" align="flex-start">
            <Icon name="alert" color={theme.status.warning} size={12} />
            <AppText variant="micro" style={{ flex: 1, color: theme.status.warning }}>
              {warning}
            </AppText>
          </Stack>
        )}
      </Stack>
      {trailing ?? (!disabled && <Icon name="forward" tone="muted" size={theme.sizes.iconSmall} />)}
    </>
  );
  if (!onPress) return <View style={rowStyle}>{content}</View>;
  return (
    <Pressable
      accessibilityRole={checked === undefined ? 'button' : 'checkbox'}
      accessibilityLabel={title}
      accessibilityHint={disabled ? 'Coming soon' : [subtitle, warning].filter(Boolean).join('. ') || undefined}
      accessibilityState={{ disabled, checked }}
      disabled={disabled}
      onPress={() => {
        if (!gesture?.suppressPress()) onPress();
      }}
      onLongPress={
        onLongPress
          ? () => {
              if (!gesture?.suppressLongPress()) onLongPress();
            }
          : undefined
      }
      accessibilityActions={
        onLongPress ? [{ name: 'longpress', label: 'More actions' }] : undefined
      }
      onAccessibilityAction={(event) => {
        if (!disabled && event.nativeEvent.actionName === 'longpress') onLongPress?.();
      }}
      style={({ pressed }) => ({ ...rowStyle, opacity: pressed ? 0.75 : 1 })}
    >
      {content}
    </Pressable>
  );
}
