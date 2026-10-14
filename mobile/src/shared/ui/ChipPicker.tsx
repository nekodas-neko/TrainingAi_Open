import { Pressable, ScrollView } from 'react-native';
import { AppText } from './AppText';
import { Stack } from './Stack';
import { useTheme } from '../theme/ThemeProvider';
export function ChipPicker<T extends string | number>({
  label,
  value,
  options,
  onChange,
  disabled = false,
  horizontal = false,
  showLabel = true,
}: {
  label: string;
  value: T | null;
  options: readonly { label: string; value: T }[];
  onChange: (value: T | null) => void;
  disabled?: boolean;
  horizontal?: boolean;
  showLabel?: boolean;
}) {
  const { theme } = useTheme();
  const choices = (
    <Stack direction="row" wrap={!horizontal} accessibilityLabel={label}>
      {options.map((option) => (
        <Pressable
          key={option.value}
          disabled={disabled}
          accessibilityRole="button"
          accessibilityState={{ selected: value === option.value, disabled }}
          accessibilityLabel={option.label}
          onPress={() => onChange(value === option.value ? null : option.value)}
          style={{
            minHeight: theme.sizes.touchTarget,
            paddingHorizontal: theme.spacing.md,
            justifyContent: 'center',
            borderRadius: theme.radii.pill,
            borderWidth: 1,
            borderColor: value === option.value ? theme.colors.brand : theme.colors.border,
            backgroundColor:
              value === option.value ? theme.tones.brand.background : theme.colors.surface,
          }}
        >
          <AppText variant="caption" tone={value === option.value ? 'brand' : 'muted'}>
            {option.label}
          </AppText>
        </Pressable>
      ))}
    </Stack>
  );
  return (
    <Stack>
      {showLabel && <AppText variant="label">{label}</AppText>}
      {horizontal ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          {choices}
        </ScrollView>
      ) : (
        choices
      )}
    </Stack>
  );
}
