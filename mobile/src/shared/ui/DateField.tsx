import { useState } from 'react';
import { todayInTz } from '@trainingai/shared/date-utils';
import { AppButton } from './AppButton';
import { AppText } from './AppText';
import { MonthCalendar } from './MonthCalendar';
import { Sheet } from './Sheet';
import { Stack } from './Stack';
import { calendarMonth, dateInBounds, formatDateField, parseDateValue } from './pickerModel';
import { useTheme } from '../theme/ThemeProvider';

/**
 * A date the person picks from a calendar instead of typing. It stores `YYYY-MM-DD`, as the typed
 * field did; "today" is the day in the profile's `timezone`. An optional field can be cleared.
 */
export function DateField({
  label,
  value,
  onChange,
  timezone,
  optional = false,
  min,
  max,
  error,
  disabled = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  timezone: string;
  optional?: boolean;
  min?: string;
  max?: string;
  error?: string;
  disabled?: boolean;
}) {
  const { theme } = useTheme();
  const today = todayInTz(timezone);
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(calendarMonth(value, today));
  const [draft, setDraft] = useState<string | null>(parseDateValue(value));
  const shown = formatDateField(value);
  const outOfBounds = draft ? !dateInBounds(draft, min, max) : false;

  function show() {
    setDraft(parseDateValue(value));
    setMonth(calendarMonth(value, today));
    setOpen(true);
  }
  function choose(date: string) {
    setDraft(date);
    setMonth(date.slice(0, 7));
  }
  function commit(next: string) {
    onChange(next);
    setOpen(false);
  }
  return (
    <>
      <Stack gap="xs">
        <AppText variant="caption" tone="muted">
          {label}
        </AppText>
        <AppButton
          title={shown ?? (value.trim() ? value : optional ? 'Not set' : 'Choose a date')}
          accessibilityLabel={`${label}: ${shown ?? (value.trim() || 'not set')}`}
          icon="calendar"
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
            <AppButton
              title={draft ? `Set ${formatDateField(draft)}` : 'Choose a day'}
              disabled={!draft || outOfBounds}
              onPress={() => {
                if (!draft) return;
                // The sheet reads a stored `2026/11/24` as the same day: unless a different
                // day is picked, what is stored stays as it was.
                if (draft === parseDateValue(value)) setOpen(false);
                else commit(draft);
              }}
            />
            <Stack direction="row" gap="sm">
              <AppButton
                style={{ flex: 1 }}
                title="Today"
                variant="surface"
                disabled={!dateInBounds(today, min, max)}
                onPress={() => choose(today)}
              />
              {optional && (
                <AppButton
                  style={{ flex: 1 }}
                  title="Clear"
                  variant="ghost"
                  disabled={!value.trim()}
                  onPress={() => commit('')}
                />
              )}
            </Stack>
          </Stack>
        }
      >
        <MonthCalendar
          nativeStyle
          month={month}
          today={today}
          selected={draft ?? undefined}
          markers={{}}
          onMonthChange={setMonth}
          onSelect={choose}
        />
        {outOfBounds && (
          <AppText variant="caption" tone="danger">
            {min && draft && draft < min
              ? `Pick ${formatDateField(min)} or later.`
              : `Pick ${formatDateField(max)} or earlier.`}
          </AppText>
        )}
      </Sheet>
    </>
  );
}
