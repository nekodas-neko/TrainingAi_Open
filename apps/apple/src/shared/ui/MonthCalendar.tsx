import type { ReactNode } from 'react';
import { View } from 'react-native';
import { AppButton } from './AppButton';
import { AppText } from './AppText';
import { IconButton } from './IconButton';
import { Stack } from './Stack';
import { useTheme } from '../theme/ThemeProvider';

export function MonthCalendar({
  month,
  today,
  selected,
  markers,
  onMonthChange,
  onSelect,
  status,
}: {
  month: string;
  today: string;
  selected?: string;
  markers: Record<string, readonly string[]>;
  onMonthChange: (month: string) => void;
  onSelect: (date: string) => void;
  status?: ReactNode;
}) {
  const { theme } = useTheme();
  const [year, number] = month.split('-').map(Number);
  const first = (new Date(Date.UTC(year, number - 1, 1)).getUTCDay() + 6) % 7;
  const count = new Date(Date.UTC(year, number, 0)).getUTCDate();
  function move(offset: number) {
    const date = new Date(Date.UTC(year, number - 1 + offset, 1));
    onMonthChange(date.toISOString().slice(0, 7));
  }
  return (
    <Stack>
      <Stack direction="row" justify="space-between" align="center">
        <IconButton
          icon="back"
          label="Previous month"
          onPress={year > 2000 || number > 1 ? () => move(-1) : undefined}
        />
        <Stack direction="row" align="center" gap="none" style={{ flex: 1, minWidth: 0 }}>
          <AppText variant="label" numberOfLines={2} style={{ flex: 1, textAlign: 'center' }}>
            {new Intl.DateTimeFormat('en-AU', {
              month: 'long',
              year: 'numeric',
              timeZone: 'UTC',
            }).format(new Date(Date.UTC(year, number - 1, 1)))}
          </AppText>
          {status}
        </Stack>
        <IconButton
          icon="forward"
          label="Next month"
          onPress={year < 2100 || number < 12 ? () => move(1) : undefined}
        />
      </Stack>
      <Stack direction="row" style={{ gap: 0 }}>
        {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((day, index) => (
          <AppText
            key={index}
            variant="micro"
            tone="muted"
            style={{ width: `${100 / 7}%`, textAlign: 'center' }}
          >
            {day}
          </AppText>
        ))}
      </Stack>
      <Stack direction="row" wrap style={{ gap: 0 }}>
        {Array.from({ length: 42 }, (_, index) => {
          const day = index - first + 1;
          if (day < 1 || day > count) {
            return (
              <View key={index} style={{ width: `${100 / 7}%`, height: theme.sizes.button }} />
            );
          }
          const date = `${month}-${String(day).padStart(2, '0')}`;
          const names = markers[date] ?? markers[date.replace(/-/g, '/')] ?? [];
          return (
            <View key={date} style={{ width: `${100 / 7}%`, height: theme.sizes.button }}>
              <AppButton
                title={String(day)}
                accessibilityLabel={`${date}${names.length ? ', ' + names.join(', ') : ''}`}
                variant={
                  date === selected || date === today
                    ? 'primary'
                    : names.length
                      ? 'secondary'
                      : 'ghost'
                }
                onPress={() => onSelect(date)}
                style={{ height: '100%', paddingHorizontal: 0, paddingVertical: 0 }}
              />
              {names.length > 0 && (
                <View
                  pointerEvents="none"
                  style={{
                    position: 'absolute',
                    bottom: theme.spacing.xs,
                    alignSelf: 'center',
                    width: theme.spacing.xs,
                    height: theme.spacing.xs,
                    borderRadius: theme.radii.pill,
                    backgroundColor:
                      date === selected || date === today
                        ? theme.colors.onBrand
                        : theme.colors.brandText,
                  }}
                />
              )}
            </View>
          );
        })}
      </Stack>
    </Stack>
  );
}
