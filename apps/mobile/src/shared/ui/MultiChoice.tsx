import { Pressable } from 'react-native';
import { AppText } from './AppText';
import { Stack } from './Stack';
import { useTheme } from '../theme/ThemeProvider';
export function MultiChoice({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string[];
  options: readonly { value: string; label: string }[];
  onChange: (value: string[]) => void;
}) {
  const { theme } = useTheme();
  return (
    <Stack>
      <AppText variant="label">{label}</AppText>
      <Stack direction="row" wrap>
        {options.map((option) => (
          <Pressable
            key={option.value}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: value.includes(option.value) }}
            aria-checked={value.includes(option.value)}
            onPress={() =>
              onChange(
                value.includes(option.value)
                  ? value.filter((v) => v !== option.value)
                  : [...value, option.value],
              )
            }
            style={{
              minHeight: theme.sizes.touchTarget,
              paddingHorizontal: theme.spacing.md,
              justifyContent: 'center',
              borderWidth: 1,
              borderRadius: theme.radii.pill,
              borderColor: value.includes(option.value)
                ? theme.colors.brand
                : theme.colors.border,
              backgroundColor: value.includes(option.value)
                ? theme.colors.brandSurface
                : theme.colors.surface,
            }}
          >
            <AppText variant="caption" tone={value.includes(option.value) ? 'brand' : 'muted'}>
              {option.label}
            </AppText>
          </Pressable>
        ))}
      </Stack>
    </Stack>
  );
}
