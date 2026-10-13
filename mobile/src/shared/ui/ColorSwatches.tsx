import { Pressable } from 'react-native';
import { AppText } from './AppText';
import { Stack } from './Stack';
import { Icon } from './Icon';
import { useTheme } from '../theme/ThemeProvider';
export const colorChoices = [
  '#00d4ff',
  '#06b6d4',
  '#2dd4bf',
  '#22c55e',
  '#f97316',
  '#fbbf24',
  '#8b5cf6',
  '#bf5fff',
  '#f87171',
  'transparent',
];
export function nativeColor(value: unknown): string | undefined {
  return typeof value === 'string' && (value === 'transparent' || /^#[\da-f]{6}$/i.test(value))
    ? value
    : undefined;
}
export function ColorSwatches({
  label,
  value,
  onChange,
  disabled = false,
}: {
  label: string;
  value: string | undefined;
  onChange: (color: string) => void;
  disabled?: boolean;
}) {
  const { theme } = useTheme();
  return (
    <Stack>
      <AppText variant="caption" tone="muted">
        {label}
      </AppText>
      <Stack direction="row" wrap gap="xs">
        {colorChoices.map((color) => (
          <Pressable
            key={color}
            onPress={() => onChange(color)}
            disabled={disabled}
            accessibilityRole="button"
            accessibilityLabel={`${label}: ${color === 'transparent' ? 'Transparent' : color}`}
            accessibilityState={{ selected: value === color, disabled }}
            style={{
              width: theme.sizes.touchTarget,
              height: theme.sizes.touchTarget,
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: theme.radii.control,
              borderWidth: value === color ? 2 : 1,
              borderColor: value === color ? theme.colors.text : theme.colors.border,
              backgroundColor: color,
            }}
          >
            {value === color && (
              <Icon
                name="check"
                color={color === 'transparent' ? theme.colors.text : theme.colors.onSignal}
              />
            )}
            {color === 'transparent' && value !== color && (
              <AppText variant="micro">Clear</AppText>
            )}
          </Pressable>
        ))}
      </Stack>
    </Stack>
  );
}
