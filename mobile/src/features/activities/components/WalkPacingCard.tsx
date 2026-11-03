import { AppText, Card, ProgressBar, Stack } from '../../../shared/ui';
import { useTheme } from '../../../shared/theme/ThemeProvider';
import { useStrap } from '../../devices/strap/StrapProvider';
import type { RoutePoint } from '@trainingai/shared/activity/route-encoding';
import { pacingView, paceSignals } from '../data/walk-pace';
import type { WalkPace } from '../data/walk-pace';

/**
 * The interval walk's pacing card (#3525, #3549): the block's cadence target, and below it what is
 * true right now: no strap, a strap connected but waiting for cadence, or a live reading against
 * its target with the pacer's band (a mark and words beside the colour, as the current app's bar
 * does). With no cadence the reading falls to GPS speed, then heart rate, and the card says which.
 */
export function WalkPacingCard({
  kind,
  target,
  pace,
  now,
  segment,
  route,
  treadmill,
}: {
  kind: 'fast' | 'slow';
  target: number;
  pace: WalkPace | null;
  now: number;
  segment: Parameters<WalkPace['reading']>[1];
  route: RoutePoint[];
  treadmill: boolean;
}) {
  const { theme } = useTheme();
  const { state } = useStrap();
  const signals = paceSignals({ route, treadmill, strap: state, nowMs: now });
  const reading = pace?.reading(now, segment, signals) ?? null;
  const view = pacingView({
    paired: !!state.paired,
    link: state.link,
    accel: state.accel,
    spm: pace?.live(now) ?? null,
    reading,
    signals,
    treadmill,
  });
  const band =
    view.state === 'live'
      ? view.reading.band === 'green'
        ? theme.status.success
        : view.reading.band === 'amber'
          ? theme.status.warning
          : view.reading.band === 'red'
            ? theme.status.danger
            : theme.colors.muted
      : theme.colors.muted;
  return (
    <Card>
      {view.state !== 'live' || view.reading.signal === 'cadence' ? (
        <AppText variant="caption">
          {kind === 'fast' ? `Fast target ≥ ${target} spm` : `Slow target ≤ ${target} spm`}
        </AppText>
      ) : null}
      {view.state === 'live' ? (
        <Stack gap="xs" accessibilityLiveRegion="polite">
          <Stack direction="row" align="baseline" gap="xs">
            <AppText variant="metric" style={{ color: band }}>
              {view.unit === 'km/h' ? view.value.toFixed(1) : Math.round(view.value)}
            </AppText>
            <AppText variant="micro" tone="muted">
              {view.unit}
            </AppText>
            <AppText variant="caption" style={{ color: band }}>
              {view.reading.mark} {view.reading.message}
            </AppText>
          </Stack>
          <ProgressBar value={view.reading.progress} color={band} />
          {view.reading.fallbackNote ? (
            <AppText variant="micro" tone="muted">
              {view.reading.fallbackNote}
            </AppText>
          ) : null}
        </Stack>
      ) : (
        <AppText variant="micro" tone="muted">
          {view.note}
        </AppText>
      )}
    </Card>
  );
}
