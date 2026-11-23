import { Pressable } from 'react-native';
import { AppText } from './AppText';
import { Stack } from './Stack';
import { useTheme } from '../theme/ThemeProvider';

export function ChoiceScale({
  label,
  options,
  value,
  onChange,
  disabled = false,
}: {
  label: string;
  options: readonly { value: number; label: string; description: string }[];
  value: number | null;
  onChange: (value: number) => void;
  disabled?: boolean;
}) {
  const { theme } = useTheme();
  return (
    <Stack direction="row" gap="xs" accessibilityLabel={label}>
      {options.map((option) => (
        <Pressable
          key={option.value}
          accessibilityRole="radio"
          accessibilityLabel={`${label} ${option.label}, ${option.description}`}
          accessibilityState={{ checked: value === option.value, disabled }}
          aria-checked={value === option.value}
          disabled={disabled}
          onPress={() => onChange(option.value)}
          style={{
            flex: 1,
            minHeight: theme.sizes.touchTarget,
            justifyContent: 'center',
            alignItems: 'center',
            // A label that wraps (#3745's "Harder than expected") stays centred, off the edges.
            paddingHorizontal: theme.spacing.xs,
            borderRadius: theme.radii.small,
            backgroundColor:
              value === option.value ? theme.colors.brand : theme.colors.raised,
          }}
        >
          <AppText
            accessibilityRole="text"
            variant="label"
            style={{
              textAlign: 'center',
              color: disabled
                ? theme.colors.disabled
                : value === option.value
                  ? theme.colors.onBrand
                  : theme.colors.brandText,
            }}
          >
            {option.label}
          </AppText>
        </Pressable>
      ))}
    </Stack>
  );
}
