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
  colorForValue,
  large = false,
}: {
  label: string;
  options: readonly { value: number; label: string; description: string }[];
  value: number | null;
  onChange: (value: number) => void;
  disabled?: boolean;
  colorForValue?: (value: number) => string;
  large?: boolean;
}) {
  const { theme } = useTheme();
  return (
    <Stack direction="row" gap={large ? 'sm' : 'xs'} accessibilityLabel={label}>
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
            minHeight: large ? theme.sizes.loggingControl : theme.sizes.touchTarget,
            justifyContent: 'center',
            alignItems: 'center',
            borderRadius: theme.radii.small,
            backgroundColor: colorForValue
              ? value === option.value
                ? colorForValue(option.value)
                : `${colorForValue(option.value)}${value !== null && option.value <= value ? '44' : '18'}`
              : value === option.value
                ? theme.colors.brand
                : theme.colors.raised,
          }}
        >
          <AppText
            accessibilityRole="text"
            variant={large ? 'heading' : colorForValue ? 'micro' : 'label'}
            style={{
              color: disabled
                ? theme.colors.disabled
                : colorForValue
                  ? value === option.value
                    ? theme.colors.onSignal
                    : colorForValue(option.value)
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
