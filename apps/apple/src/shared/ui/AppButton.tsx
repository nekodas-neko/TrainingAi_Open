import { ActivityIndicator, Pressable, type PressableProps } from 'react-native';
import { AppText } from './AppText';
import { Stack } from './Stack';
import { Icon, type IconName } from './Icon';
import { useTheme } from '../theme/ThemeProvider';

export function AppButton({
  title,
  variant = 'primary',
  busy = false,
  icon,
  disabled = false,
  style,
  ...props
}: Omit<PressableProps, 'children'> & {
  title: string;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  busy?: boolean;
  icon?: IconName;
}) {
  const { theme } = useTheme();
  const blocked = disabled || busy || !props.onPress;
  const foreground = blocked
    ? theme.colors.disabled
    : variant === 'primary'
      ? theme.colors.onBrand
      : variant === 'danger'
        ? theme.colors.danger
        : theme.colors.brandText;
  const background = blocked
    ? theme.colors.raised
    : variant === 'primary'
      ? theme.colors.brand
      : variant === 'secondary'
        ? theme.colors.brandSurface
        : 'transparent';
  return (
    <Pressable
      {...props}
      accessibilityRole="button"
      accessibilityState={{ disabled: blocked, busy }}
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
          opacity: state.pressed ? 0.75 : 1,
        },
        typeof style === 'function' ? style(state) : style,
      ]}
    >
      <Stack direction="row" align="center">
        {busy && <ActivityIndicator color={foreground} />}
        {icon && !busy && <Icon name={icon} color={foreground} size={theme.sizes.iconSmall} />}
        <AppText variant="label" style={{ color: foreground, textAlign: 'center' }}>
          {title}
        </AppText>
      </Stack>
    </Pressable>
  );
}
