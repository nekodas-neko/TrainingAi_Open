import type { ReactNode } from 'react';
import { Pressable, View } from 'react-native';
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
  dots,
  onMonthChange,
  onSelect,
  status,
  nativeStyle = false,
}: {
  month: string;
  today: string;
  selected?: string;
  markers: Record<string, readonly string[]>;
  // Coloured dots per date, in draw order. When given they replace the filled circle and the
  // single dot a marked day gets.
  dots?: Record<string, readonly string[]>;
  onMonthChange: (month: string) => void;
  onSelect: (date: string) => void;
  status?: ReactNode;
  nativeStyle?: boolean;
}) {
  const { theme } = useTheme();
  const [year, number] = month.split('-').map(Number);
  const first = (new Date(Date.UTC(year, number - 1, 1)).getUTCDay() + 6) % 7;
  const count = new Date(Date.UTC(year, number, 0)).getUTCDate();
  const cells = Math.ceil((first + count) / 7) * 7;
  function move(offset: number) {
    const date = new Date(Date.UTC(year, number - 1 + offset, 1));
    onMonthChange(`${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`);
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
        {Array.from({ length: cells }, (_, index) => {
          const day = index - first + 1;
          if (day < 1 || day > count) {
            return (
              <View key={index} style={{ width: `${100 / 7}%`, height: theme.sizes.button }} />
            );
          }
          const date = `${month}-${String(day).padStart(2, '0')}`;
          const names = markers[date] ?? markers[date.replace(/-/g, '/')] ?? [];
          const colors = dots ? (dots[date] ?? dots[date.replace(/-/g, '/')] ?? []) : [];
          return (
            <View key={date} style={{ width: `${100 / 7}%`, height: theme.sizes.button }}>
              {nativeStyle ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${date}${names.length ? ', ' + names.join(', ') : ''}`}
                  accessibilityState={{ selected: date === selected }}
                  onPress={() => onSelect(date)}
                  style={({ pressed }) => ({
                    flex: 1,
                    alignItems: 'center',
                    justifyContent: 'center',
                    opacity: pressed ? 0.6 : 1,
                  })}
                >
                  <View
                    style={{
                      width: theme.sizes.weekDay,
                      height: theme.sizes.weekDay,
                      borderRadius: theme.radii.pill,
                      alignItems: 'center',
                      justifyContent: 'center',
                      backgroundColor:
                        date === selected
                          ? theme.colors.brand
                          : names.length && !dots
                            ? theme.colors.brandSurface
                            : 'transparent',
                      borderWidth: date === today ? 1 : 0,
                      borderColor: theme.colors.brand,
                    }}
                  >
                    <AppText
                      variant="label"
                      style={{
                        color:
                          date === selected
                            ? theme.colors.onBrand
                            : date === today
                              ? theme.colors.brandText
                              : date > today
                                ? theme.colors.muted
                                : theme.colors.text,
                        fontVariant: ['tabular-nums'],
                      }}
                    >
                      {day}
                    </AppText>
                  </View>
                </Pressable>
              ) : (
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
              )}
              {colors.length > 0 && (
                <Stack
                  direction="row"
                  gap="xxs"
                  pointerEvents="none"
                  style={{
                    position: 'absolute',
                    bottom: theme.spacing.xs,
                    alignSelf: 'center',
                  }}
                >
                  {colors.slice(0, 4).map((color, at) => (
                    <View
                      key={at}
                      style={{
                        width: theme.spacing.xs,
                        height: theme.spacing.xs,
                        borderRadius: theme.radii.pill,
                        backgroundColor: color,
                      }}
                    />
                  ))}
                </Stack>
              )}
              {!dots && names.length > 0 && (
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
                      date === selected || (!nativeStyle && date === today)
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
