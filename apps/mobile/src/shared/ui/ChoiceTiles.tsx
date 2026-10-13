import { Pressable } from 'react-native';
import { AppText } from './AppText';
import { Stack } from './Stack';
import { useTheme } from '../theme/ThemeProvider';
export function ChoiceTiles<T extends string | number>({
  label,
  value,
  options,
  onChange,
  disabled = false,
}: {
  label: string;
  value: T | null;
  options: readonly { value: T; label: string; caption?: string; emoji?: string }[];
  onChange: (value: T) => void;
  disabled?: boolean;
}) {
  const { theme } = useTheme();
  return (
    <Stack>
      <AppText variant="label">{label}</AppText>
      <Stack direction="row" gap="xs" accessibilityRole="radiogroup" accessibilityLabel={label}>
        {options.map((option) => (
          <Pressable
            key={option.value}
            disabled={disabled}
            onPress={() => onChange(option.value)}
            accessibilityRole="radio"
            accessibilityLabel={`${option.label}${option.caption?.trim() ? `, ${option.caption.trim()}` : ''}`}
            aria-checked={value === option.value}
            accessibilityState={{ checked: value === option.value, disabled }}
            style={{
              flex: 1,
              minHeight: theme.sizes.button,
              justifyContent: 'center',
              alignItems: 'center',
              gap: theme.spacing.xxs,
              padding: theme.spacing.xs,
              borderRadius: theme.radii.control,
              borderWidth: 1,
              borderColor: value === option.value ? theme.colors.brand : theme.colors.border,
              backgroundColor:
                value === option.value ? theme.colors.brandSurface : theme.colors.raised,
            }}
          >
            {option.emoji && (
              <AppText variant="score" style={{ opacity: value === option.value ? 1 : 0.45 }}>
                {option.emoji}
              </AppText>
            )}
            <AppText variant="caption">{option.label}</AppText>
            {option.caption && (
              <AppText variant="micro" tone="muted">
                {option.caption}
              </AppText>
            )}
          </Pressable>
        ))}
      </Stack>
    </Stack>
  );
}
