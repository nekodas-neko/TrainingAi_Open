import { AppText, Card, ProgressBar, Stack } from '../../../shared/ui';
import { useTheme } from '../../../shared/theme/ThemeProvider';
import { useStrap } from '../../devices/strap/StrapProvider';
import { pacingView } from '../data/walk-pace';
import type { WalkPace } from '../data/walk-pace';

/**
 * The interval walk's pacing card (#3525): the block's cadence target, and below it what is true
 * right now: no strap, a strap connected but waiting for cadence, or live cadence against the
 * target with the pacer's band (a mark and words beside the colour, as the current app's bar does).
 */
export function WalkPacingCard({
  kind,
  target,
  pace,
  now,
  segment,
}: {
  kind: 'fast' | 'slow';
  target: number;
  pace: WalkPace | null;
  now: number;
  segment: Parameters<WalkPace['reading']>[1];
}) {
  const { theme } = useTheme();
  const { state } = useStrap();
  const reading = pace?.reading(now, segment) ?? null;
  const view = pacingView({
    paired: !!state.paired,
    link: state.link,
    accel: state.accel,
    spm: pace?.live(now) ?? null,
    reading,
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
      <AppText variant="caption">
        {kind === 'fast' ? `Fast target ≥ ${target} spm` : `Slow target ≤ ${target} spm`}
      </AppText>
      {view.state === 'live' ? (
        <Stack gap="xs" accessibilityLiveRegion="polite">
          <Stack direction="row" align="baseline" gap="xs">
            <AppText variant="metric" style={{ color: band }}>
              {Math.round(view.spm)}
            </AppText>
            <AppText variant="micro" tone="muted">
              spm
            </AppText>
            <AppText variant="caption" style={{ color: band }}>
              {view.reading.mark} {view.reading.message}
            </AppText>
          </Stack>
          <ProgressBar value={view.reading.progress} color={band} />
        </Stack>
      ) : (
        <AppText variant="micro" tone="muted">
          {view.note}
        </AppText>
      )}
    </Card>
  );
}
