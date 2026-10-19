import { View } from 'react-native';
import { AppText, Card, Icon, LineChart, Stack } from '../../../shared/ui';
import { useTheme } from '../../../shared/theme/ThemeProvider';
import { useClock } from '../../../shared/hooks/useClock';
import { useStrap } from '../../devices/strap/StrapProvider';
import { liveHrView } from '../../devices/strap/labels';

const TRACE_HEIGHT = 44;

// The current app's Live HR card on the rest screen (`components/workout/live-hr-chart.tsx`,
// compact, `sinceMs` = the rest's start): this rest's trace, the zone chip and colour, the smoothed
// bpm. Only with a strap paired: Preview has no other live source. The profile is passed in, read
// once by the workout screen, as the current app does (RV-64).
export function LiveHrCard({
  sinceMs,
  profile,
}: {
  sinceMs: number | null;
  profile: { maxHr: number; restingHr: number } | null;
}) {
  const { theme } = useTheme();
  const { state } = useStrap();
  const now = useClock(!!state.paired);
  if (!state.paired) return null;
  const view = liveHrView(state, now, sinceMs, profile);
  const accent = view.zone?.color ?? theme.colors.brand;
  const origin = sinceMs ?? view.points[0]?.at ?? now;
  return (
    <Card style={{ opacity: view.stale ? 0.7 : 1, gap: theme.spacing.xs }}>
      <Stack direction="row" align="center" justify="space-between">
        <Stack direction="row" align="center">
          <Icon name="health" color={accent} />
          <AppText variant="eyebrow" tone="muted">
            Live HR
          </AppText>
        </Stack>
        <Stack direction="row" align="baseline">
          {view.zone && (
            <View
              style={{
                borderRadius: theme.radii.pill,
                paddingHorizontal: theme.spacing.xs,
                backgroundColor: `${accent}29`,
              }}
            >
              <AppText variant="micro" style={{ color: accent }}>
                {view.zone.name.toUpperCase()}
              </AppText>
            </View>
          )}
          <AppText
            variant="metric"
            style={{ color: accent }}
            accessibilityLabel={view.bpm === null ? 'No reading' : `${view.bpm} bpm`}
          >
            {view.bpm ?? '—'}
          </AppText>
          <AppText variant="micro" tone="muted">
            bpm
          </AppText>
        </Stack>
      </Stack>
      {view.points.length >= 2 ? (
        <LineChart
          label="Live heart rate this rest"
          points={view.points.map((x) => ({
            label: `${x.bpm} bpm`,
            x: (x.at - origin) / 1000,
            value: x.bpm,
          }))}
          height={TRACE_HEIGHT}
          showLabels={false}
          fill
          color={accent}
          dots="isolated"
        />
      ) : (
        <View style={{ height: TRACE_HEIGHT, justifyContent: 'center' }}>
          <AppText variant="caption" tone="muted">
            {view.message}
          </AppText>
        </View>
      )}
    </Card>
  );
}
