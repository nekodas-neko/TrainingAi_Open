import { AppButton } from './AppButton';
import { Stack } from './Stack';
import { TextField } from './TextField';
import { useTheme } from '../theme/ThemeProvider';

export function NumericStepper({
  label,
  accessibilityLabel = label,
  value,
  onChange,
  step = 1,
  min = 0,
  max,
  disabled = false,
}: {
  label: string;
  accessibilityLabel?: string;
  value: string;
  onChange: (value: string) => void;
  step?: number;
  min?: number;
  max: number;
  disabled?: boolean;
}) {
  const { theme } = useTheme();
  const number = Number(value.trim().replace(',', '.'));
  function adjust(direction: number) {
    const next = Math.min(
      max,
      Math.max(min, (Number.isFinite(number) ? number : 0) + direction * step),
    );
    onChange(String(Math.round(next * 100) / 100));
  }
  return (
    <Stack gap="sm" style={{ flex: 1 }}>
      <TextField
        label={label}
        accessibilityLabel={accessibilityLabel}
        value={value}
        onChangeText={onChange}
        editable={!disabled}
        keyboardType={step === 1 && min === 0 ? 'number-pad' : 'numbers-and-punctuation'}
        returnKeyType="done"
        selectTextOnFocus
        style={{ ...theme.typography.metric, textAlign: 'center' }}
      />
      <Stack direction="row" gap="sm">
        <AppButton
          title="−"
          accessibilityLabel={`Decrease ${accessibilityLabel}`}
          variant="secondary"
          disabled={disabled || (value !== '' && number <= min)}
          onPress={() => adjust(-1)}
          style={{ flex: 1 }}
        />
        <AppButton
          title="+"
          accessibilityLabel={`Increase ${accessibilityLabel}`}
          variant="secondary"
          disabled={disabled || number >= max}
          onPress={() => adjust(1)}
          style={{ flex: 1 }}
        />
      </Stack>
    </Stack>
  );
}
