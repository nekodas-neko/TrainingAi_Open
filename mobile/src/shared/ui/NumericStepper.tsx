import { AppButton } from './AppButton';
import { Stack } from './Stack';
import { TextField } from './TextField';
import { useTheme } from '../theme/ThemeProvider';
import type { StyleProp, ViewStyle } from 'react-native';
import { IconButton } from './IconButton';
import { AppText } from './AppText';

export function NumericStepper({
  label,
  accessibilityLabel = label,
  value,
  onChange,
  step = 1,
  min = 0,
  max,
  disabled = false,
  style,
  inline = false,
}: {
  label: string;
  accessibilityLabel?: string;
  value: string;
  onChange: (value: string) => void;
  step?: number;
  min?: number;
  max: number;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  inline?: boolean;
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
  if (inline)
    return (
      <Stack gap="xs" style={[{ flex: 1 }, style]}>
        <AppText variant="caption" tone="muted">
          {label}
        </AppText>
        <Stack direction="row" align="center" gap="xs">
          <IconButton
            icon="minus"
            tone="brand"
            label={`Decrease ${accessibilityLabel}`}
            disabled={disabled || (value !== '' && number <= min)}
            onPress={() => adjust(-1)}
          />
          <TextField
            label={label}
            accessibilityLabel={accessibilityLabel}
            hideLabel
            value={value}
            onChangeText={onChange}
            editable={!disabled}
            keyboardType="number-pad"
            selectTextOnFocus
            style={{ textAlign: 'center' }}
          />
          <IconButton
            icon="plus"
            tone="brand"
            label={`Increase ${accessibilityLabel}`}
            disabled={disabled || number >= max}
            onPress={() => adjust(1)}
          />
        </Stack>
      </Stack>
    );
  return (
    <Stack gap="sm" style={[{ flex: 1 }, style]}>
      <TextField
        containerStyle={{ flexGrow: 0, flexShrink: 0, flexBasis: 'auto' }}
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
