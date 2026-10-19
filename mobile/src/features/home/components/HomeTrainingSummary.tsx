import { Pressable, View } from 'react-native';
import { AppText, Card, Grid, ProgressBar, Stack, TouchSurface } from '../../../shared/ui';
import { useTheme } from '../../../shared/theme/ThemeProvider';
import { shiftDateStr, formatDateDisplay } from '@trainingai/shared/date-utils';
import { sessionFills } from '../../../shared/theme/tokens';
import { streakRestNotice } from '@trainingai/shared/workout/day-streak';
import { homeStreak, trainingWeek } from '../data/models';
import type { HomeSchedule } from '../data/models';
import { useHome } from '../data/HomeProvider';
import { useWorkoutContext } from '../../workouts/WorkoutProvider';
export function HomeTrainingSummary({
  days,
  today,
  loaded,
  streakLoaded,
  schedule,
  target,
  ai,
  openStats,
}: {
  days: Record<string, string[]>;
  today: string;
  loaded: boolean;
  streakLoaded: boolean;
  schedule: HomeSchedule | null;
  target: number | null;
  ai: boolean;
  openStats: () => void;
}) {
  const { theme } = useTheme();
  const { preferences } = useHome();
  const count = trainingWeek(days, today).filter((day) => !day.future && day.names.length).length;
  const streak = homeStreak(days, today, schedule);
  const { catalog } = useWorkoutContext();
  const strip = streakRestNotice(catalog?.recommendation);
  const stripColor =
    strip?.kind === 'broken'
      ? theme.colors.danger
      : strip?.kind === 'warning'
        ? theme.status.warning
        : theme.colors.muted;
  return (
    <Stack>
      <Grid columns={2}>
        <TouchSurface
          fill
          accessibilityRole="button"
          accessibilityLabel="View training streak and statistics"
          onPress={openStats}
          style={{ flex: 1 }}
        >
          <Card
            tone="brand"
            style={{ flex: 1 }}
            accent={preferences.cardColors?.streakLeft ?? theme.homeCards.streakLeft}
          >
            <AppText variant="eyebrow" tone="muted">
              Streak
            </AppText>
            <AppText variant="hero" tone="brand">
              {streakLoaded && streak > 0 ? streak : '—'}{' '}
              <AppText variant="caption" tone="muted">
                days
              </AppText>
            </AppText>
            <Stack
              direction="row"
              gap="xxs"
              style={{
                marginTop: 'auto',
                minHeight: theme.spacing.lg,
                alignItems: 'center',
              }}
            >
              {Array.from({ length: 10 }, (_, i) => (
                <View
                  key={i}
                  style={{
                    width: theme.spacing.sm,
                    height: theme.spacing.sm,
                    borderRadius: theme.spacing.xxs,
                    backgroundColor:
                      loaded && days[shiftDateStr(today, i - 9)]?.length
                        ? theme.colors.brand
                        : theme.colors.brandSurface,
                  }}
                />
              ))}
            </Stack>
          </Card>
        </TouchSurface>
        <TouchSurface
          fill
          accessibilityRole="button"
          accessibilityLabel="View this week’s training statistics"
          onPress={openStats}
          style={{ flex: 1 }}
        >
          <Card
            style={{ flex: 1 }}
            accent={preferences.cardColors?.streakRight ?? theme.homeCards.streakRight}
          >
            <AppText variant="eyebrow" tone="muted">
              This Week
            </AppText>
            <AppText variant="hero">
              {loaded ? count : '—'}
              {!ai && target !== null && (
                <AppText variant="caption" tone="muted">
                  {' '}
                  / {target}
                </AppText>
              )}
            </AppText>
            {ai ? (
              <AppText variant="caption" tone="muted">
                sessions this week
              </AppText>
            ) : (
              <Stack
                style={{
                  marginTop: 'auto',
                  minHeight: theme.spacing.lg,
                  justifyContent: 'center',
                }}
              >
                <ProgressBar value={loaded && target ? count / target : 0} />
              </Stack>
            )}
          </Card>
        </TouchSurface>
      </Grid>
      {strip && (
        <View
          style={{
            borderRadius: theme.radii.small,
            borderWidth: 1,
            borderColor: `${stripColor}40`,
            backgroundColor: `${stripColor}1f`,
            paddingHorizontal: theme.spacing.md,
            paddingVertical: theme.spacing.xs,
            alignItems: 'center',
          }}
        >
          <AppText variant="caption" style={{ color: stripColor, fontWeight: '500' }}>
            {strip.text}
          </AppText>
        </View>
      )}
    </Stack>
  );
}
export function HomeWeekStrip({
  days,
  today,
  loaded,
  hasProgram,
  openDay,
}: {
  days: Record<string, string[]>;
  today: string;
  loaded: boolean;
  hasProgram: boolean;
  openDay: (day: string) => void;
}) {
  const { theme } = useTheme();
  const { catalog } = useWorkoutContext();
  const sessions = catalog?.program?.sessions ?? [];
  return (
    <Stack direction="row" gap="xs">
      {trainingWeek(days, today).map((day) => {
        // The web fills a trained day with its session's palette colour, by the session's position
        // in the program (week-strip-card.tsx); an untrained day is a neutral tile.
        const index = sessions.findIndex((session) => day.names.includes(session.name));
        const fill = index >= 0 ? sessionFills[index % sessionFills.length] : null;
        return (
          <Pressable
            key={day.date}
            disabled={day.future}
            accessibilityRole="button"
            accessibilityLabel={`${formatDateDisplay(day.date, 'long')}${day.isToday ? ', today' : ''}, ${day.names.join(', ') || 'nothing logged'}`}
            onPress={() => openDay(day.date)}
            style={{ flex: 1, alignItems: 'center', gap: theme.spacing.xs }}
          >
            <AppText variant="caption" tone={day.isToday ? 'brand' : 'muted'}>
              {day.label}
            </AppText>
            <View
              style={{
                width: theme.sizes.weekDay,
                height: theme.sizes.weekDay,
                borderRadius: theme.radii.control,
                justifyContent: 'center',
                alignItems: 'center',
                borderWidth: day.isToday && !fill ? 2 : 1,
                borderColor: fill
                  ? 'transparent'
                  : day.isToday
                    ? theme.colors.brand
                    : theme.colors.border,
                backgroundColor: fill
                  ? fill
                  : day.isToday
                    ? theme.colors.brandSurface
                    : theme.colors.raised,
                opacity: day.future ? 0.4 : 1,
              }}
            >
              <AppText
                variant="micro"
                tone={day.names.length ? 'brand' : 'muted'}
                style={fill ? { color: theme.colors.onBrand } : undefined}
              >
                {day.names.length
                  ? '●'
                  : day.isToday || day.future
                    ? String(Number(day.date.slice(8)))
                    : loaded && hasProgram
                      ? 'rest'
                      : '—'}
              </AppText>
            </View>
            <AppText variant="micro" tone="muted" numberOfLines={1} style={{ maxWidth: '100%' }}>
              {day.names[0] ?? (day.isToday ? 'today' : '—')}
            </AppText>
          </Pressable>
        );
      })}
    </Stack>
  );
}
