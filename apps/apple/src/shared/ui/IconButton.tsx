import { ActivityIndicator, Pressable } from 'react-native';
import { Icon, type IconName } from './Icon';
import { useTheme } from '../theme/ThemeProvider';

export function IconButton({
  icon,
  label,
  onPress,
  busy = false,
  hint,
}: {
  icon: IconName;
  label: string;
  onPress?: () => void;
  busy?: boolean;
  hint?: string;
}) {
  const { theme } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hint}
      accessibilityState={{ disabled: !onPress || busy, busy }}
      disabled={!onPress || busy}
      onPress={onPress}
      style={({ pressed }) => ({
        width: theme.sizes.touchTarget,
        height: theme.sizes.touchTarget,
        borderRadius: theme.radii.control,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: pressed ? theme.colors.raised : 'transparent',
      })}
    >
      {busy ? (
        <ActivityIndicator color={theme.colors.muted} />
      ) : (
        <Icon name={icon} tone="muted" size={theme.sizes.iconSmall} />
      )}
    </Pressable>
  );
}
