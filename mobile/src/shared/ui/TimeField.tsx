import { useState } from 'react';
import { View } from 'react-native';
import { msToHHMMInTz, todayInTz } from '@trainingai/shared/date-utils';
import { AppButton } from './AppButton';
import { AppText } from './AppText';
import { NumberWheel } from './NumberWheel';
import { Sheet } from './Sheet';
import { Stack } from './Stack';
import {
  formatTimeField,
  parseTimeValue,
  shiftTime,
  toTimeValue,
  type TimeOfDay,
} from './pickerModel';
import { useTheme } from '../theme/ThemeProvider';

/**
 * A time of day set on two wheels instead of typed. It stores `HH:MM` on a 24-hour clock, as the
 * typed field did, and reads back through `formatTimeOfDay` in the profile's `timezone`. Minutes
 * run in fives; "1 min earlier / later" reach any exact minute. An optional field can be cleared.
 */
export function TimeField({
  label,
  value,
  onChange,
  timezone,
  optional = false,
  error,
  disabled = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  timezone: string;
  optional?: boolean;
  error?: string;
  disabled?: boolean;
}) {
  const { theme } = useTheme();
  const today = todayInTz(timezone);
  const [open, setOpen] = useState(false);
  const fallback = (): TimeOfDay =>
    parseTimeValue(msToHHMMInTz(new Date(), timezone)) ?? { hour: 8, minute: 0 };
  const [draft, setDraft] = useState<TimeOfDay>(() => parseTimeValue(value) ?? fallback());
  const shown = formatTimeField(value, timezone, today);

  function show() {
    setDraft(parseTimeValue(value) ?? fallback());
    setOpen(true);
  }
  function commit(next: string) {
    onChange(next);
    setOpen(false);
  }
  const draftText = formatTimeField(toTimeValue(draft), timezone, today) ?? toTimeValue(draft);
  return (
    <>
      <Stack gap="xs">
        <AppText variant="caption" tone="muted">
          {label}
        </AppText>
        <AppButton
          title={shown ?? (value.trim() ? value : optional ? 'Not set' : 'Choose a time')}
          accessibilityLabel={`${label}: ${shown ?? (value.trim() || 'not set')}`}
          icon="clock"
          variant="surface"
          disabled={disabled}
          onPress={show}
          style={{
            minHeight: theme.sizes.touchTarget,
            borderColor: error ? theme.colors.danger : undefined,
          }}
        />
        {!!error && (
          <AppText variant="caption" tone="danger">
            {error}
          </AppText>
        )}
      </Stack>
      <Sheet
        visible={open}
        title={label}
        onClose={() => setOpen(false)}
        footer={
          <Stack gap="sm">
            <AppButton title={`Set ${draftText}`} onPress={() => commit(toTimeValue(draft))} />
            {optional && (
              <AppButton
                title="Clear"
                variant="ghost"
                disabled={!value.trim()}
                onPress={() => commit('')}
              />
            )}
          </Stack>
        }
      >
        <Stack direction="row" gap="md" style={{ height: theme.sizes.wheelRow * 3 }}>
          <View style={{ flex: 1 }}>
            <NumberWheel
              label="Hour"
              value={String(draft.hour)}
              min={0}
              max={23}
              pad={2}
              onChange={(hour) => setDraft((old) => ({ ...old, hour: Number(hour) }))}
            />
          </View>
          <View style={{ flex: 1 }}>
            <NumberWheel
              label="Minute"
              value={String(draft.minute)}
              min={0}
              max={59}
              step={5}
              pad={2}
              onChange={(minute) => setDraft((old) => ({ ...old, minute: Number(minute) }))}
            />
          </View>
        </Stack>
        <Stack direction="row" gap="sm">
          <AppButton
            style={{ flex: 1 }}
            title="1 min earlier"
            variant="surface"
            onPress={() => setDraft((old) => shiftTime(old, -1))}
          />
          <AppButton
            style={{ flex: 1 }}
            title="1 min later"
            variant="surface"
            onPress={() => setDraft((old) => shiftTime(old, 1))}
          />
        </Stack>
      </Sheet>
    </>
  );
}
