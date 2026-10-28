import { ActivityIndicator, Pressable, type PressableProps } from 'react-native';
import { AppText } from './AppText';
import { Stack } from './Stack';
import { Icon, type IconName } from './Icon';
import { useTheme } from '../theme/ThemeProvider';
import type { TextVariant } from '../theme/tokens';

export function AppButton({
  title,
  variant = 'primary',
  busy = false,
  icon,
  iconSize,
  iconColor,
  disabled = false,
  textVariant = 'button',
  style,
  ...props
}: Omit<PressableProps, 'children'> & {
  title: string;
  variant?: 'primary' | 'neutral' | 'secondary' | 'surface' | 'ghost' | 'danger' | 'warning';
  busy?: boolean;
  icon?: IconName;
  iconSize?: number;
  /** Colour of the icon when it should differ from the label (the web's muted End of Day moon). */
  iconColor?: string;
  textVariant?: TextVariant;
}) {
  const { theme } = useTheme();
  const blocked = disabled || busy || !props.onPress;
  const foreground = blocked
    ? theme.colors.disabled
    : variant === 'primary' || variant === 'warning'
      ? theme.colors.onBrand
      : variant === 'neutral'
        ? theme.colors.onPrimary
        : variant === 'danger'
          ? theme.colors.danger
          : variant === 'surface'
            ? theme.colors.text
            : theme.colors.brandText;
  const background = blocked
    ? theme.colors.raised
    : variant === 'primary'
      ? theme.colors.brand
      : variant === 'neutral'
        ? theme.colors.primary
        : variant === 'warning'
          ? theme.status.warning
          : variant === 'secondary'
            ? theme.colors.brandSurface
            : variant === 'surface'
              ? theme.colors.surface
              : 'transparent';
  return (
    <Pressable
      {...props}
      accessibilityRole="button"
      accessibilityState={{ ...props.accessibilityState, disabled: blocked, busy }}
      disabled={blocked}
      style={(state) => [
        {
          minHeight: theme.sizes.button,
          borderRadius: theme.radii.control,
          paddingHorizontal: theme.spacing.lg,
          paddingVertical: theme.spacing.md,
          justifyContent: 'center',
          alignItems: 'center',
          backgroundColor: background,
          borderWidth: variant === 'surface' ? 1 : 0,
          borderColor: theme.colors.border,
          opacity: state.pressed ? 0.75 : 1,
        },
        typeof style === 'function' ? style(state) : style,
      ]}
    >
      <Stack direction="row" align="center">
        {busy && <ActivityIndicator color={foreground} />}
        {icon && !busy && (
          <Icon name={icon} color={blocked ? foreground : (iconColor ?? foreground)} size={iconSize ?? theme.sizes.iconSmall} />
        )}
        {title.length > 0 && (
          <AppText
            variant={textVariant}
            style={{ color: foreground, textAlign: 'center' }}
          >
            {title}
          </AppText>
        )}
      </Stack>
    </Pressable>
  );
}
