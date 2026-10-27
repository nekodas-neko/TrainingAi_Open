import { useState, type ReactNode } from 'react';
import { PixelRatio, Pressable, View } from 'react-native';
import { AppButton } from './AppButton';
import { AppText } from './AppText';
import { IconButton } from './IconButton';
import { Stack } from './Stack';
import { monthGrid, stackCalendarTitle, stackCalendarTitleToFit } from './monthGrid';
import { textScale } from '../theme/text-scale';
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
  topAligned = false,
  title,
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
  /** Date at the top of its cell, leaving the bottom for the dots. Fixed for the host's
   *  lifetime (not tied to loading) so dates never move when data lands. */
  topAligned?: boolean;
  /** Heading drawn on the same row as the month controls, as the current app's calendar does. */
  title?: string;
}) {
  const { theme } = useTheme();
  const [year, number] = month.split('-').map(Number);
  // Measured widths decide whether the title fits beside the controls; until all three land the
  // text scale decides, so the first paint is already close and rarely moves.
  const [rowWidth, setRowWidth] = useState<number | null>(null);
  const [controlsWidth, setControlsWidth] = useState<number | null>(null);
  const [titleWidth, setTitleWidth] = useState<number | null>(null);
  const { first, count, cells } = monthGrid(month);
  function move(offset: number) {
    const date = new Date(Date.UTC(year, number - 1 + offset, 1));
    onMonthChange(`${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`);
  }
  const monthLabel = new Intl.DateTimeFormat('en-AU', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(year, number - 1, 1)));
  const back = (
    <IconButton
      icon="back"
      label="Previous month"
      onPress={year > 2000 || number > 1 ? () => move(-1) : undefined}
    />
  );
  const forward = (
    <IconButton
      icon="forward"
      label="Next month"
      onPress={year < 2100 || number < 12 ? () => move(1) : undefined}
    />
  );
  // The current app's w-24 month label between the arrows, 4 px apart.
  const controls = (
    <Stack
      direction="row"
      align="center"
      gap="xs"
      style={{ flexShrink: 0 }}
      onLayout={(event) => setControlsWidth(event.nativeEvent.layout.width)}
    >
      {back}
      <AppText
        variant="calendarDay"
        numberOfLines={2}
        style={{
          width: theme.sizes.calendarMonthLabel,
          textAlign: 'center',
          fontVariant: ['tabular-nums'],
        }}
      >
        {monthLabel}
      </AppText>
      {status}
      {forward}
    </Stack>
  );
  const stacked =
    !!title &&
    (rowWidth !== null && controlsWidth !== null && titleWidth !== null
      ? stackCalendarTitleToFit({
          rowWidth,
          controlsWidth,
          titleWidth,
          gap: theme.spacing.xs,
        })
      : stackCalendarTitle(textScale(PixelRatio.getFontScale())));
  return (
    <Stack onLayout={(event) => setRowWidth(event.nativeEvent.layout.width)}>
      {title ? (
        <Stack gap={stacked ? 'xs' : 'none'}>
          {/* Invisible one-line copy of the title, to learn the width it needs. */}
          <AppText
            variant="groupTitle"
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            pointerEvents="none"
            numberOfLines={1}
            onLayout={(event) => setTitleWidth(Math.ceil(event.nativeEvent.layout.width))}
            style={{ position: 'absolute', opacity: 0, alignSelf: 'flex-start' }}
          >
            {title}
          </AppText>
          <Stack direction="row" align="center" justify="space-between">
            <AppText
              variant="groupTitle"
              tone="muted"
              accessibilityRole="header"
              numberOfLines={2}
              style={{ flex: 1, minWidth: 0 }}
            >
              {title}
            </AppText>
            {!stacked && controls}
          </Stack>
          {stacked && controls}
        </Stack>
      ) : (
        <Stack direction="row" justify="space-between" align="center">
          {back}
          <Stack direction="row" align="center" gap="none" style={{ flex: 1, minWidth: 0 }}>
            <AppText
              variant="calendarDay"
              numberOfLines={2}
              style={{ flex: 1, textAlign: 'center', fontVariant: ['tabular-nums'] }}
            >
              {monthLabel}
            </AppText>
            {status}
          </Stack>
          {forward}
        </Stack>
      )}
      <Stack direction="row" style={{ gap: 0 }}>
        {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((day, index) => (
          <AppText
            key={index}
            variant="calendarWeekday"
            tone="muted"
            style={{ width: `${100 / 7}%`, textAlign: 'center' }}
          >
            {day}
          </AppText>
        ))}
      </Stack>
      <Stack direction="row" wrap style={{ gap: 0, rowGap: theme.spacing.xxs }}>
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
                    // The dots sit under the date, so the date moves up to make room.
                    justifyContent: topAligned ? 'flex-start' : 'center',
                    paddingTop: topAligned ? theme.spacing.xxs : 0,
                    opacity: pressed ? 0.6 : 1,
                  })}
                >
                  <View
                    style={{
                      width: theme.sizes.calendarDay,
                      height: theme.sizes.calendarDay,
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
                      variant="calendarDay"
                      style={{
                        // The current app draws today's digit bold.
                        fontWeight: date === today ? '700' : undefined,
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
