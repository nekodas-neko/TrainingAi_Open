import { AppText, Card, Icon, Stack } from '../../../shared/ui';
import { useClock } from '../../../shared/hooks/useClock';
import { useStrap } from '../../devices/strap/StrapProvider';
import { liveBpm, strapBlocker } from '../../devices/strap/labels';

// The strap's live reading on the rest screen, where the current app shows its Live HR card. Only
// with a strap paired: Preview has no other live source.
export function LiveHrCard() {
  const { state } = useStrap();
  const now = useClock(!!state.paired);
  if (!state.paired) return null;
  const { bpm, live } = liveBpm(state, now);
  const blocker = strapBlocker(state);
  const note = blocker
    ? blocker.title
    : state.link === 'connected'
      ? !state.worn
        ? 'No chest contact — wet the electrodes'
        : live
          ? null
          : 'Holding last reading…'
      : state.link === 'connecting'
        ? 'Connecting to your strap…'
        : 'Strap not reachable — retrying';
  return (
    <Card style={{ opacity: bpm !== null && !live ? 0.7 : 1 }}>
      <Stack direction="row" align="center" justify="space-between">
        <Stack direction="row" align="center">
          <Icon name="health" tone="danger" />
          <AppText variant="eyebrow" tone="muted">
            Live HR
          </AppText>
        </Stack>
        <Stack direction="row" align="center">
          <AppText variant="metric" accessibilityLabel={bpm === null ? 'No reading' : `${bpm} bpm`}>
            {bpm ?? '—'}
          </AppText>
          <AppText variant="micro" tone="muted">
            bpm
          </AppText>
        </Stack>
      </Stack>
      {note && (
        <AppText variant="caption" tone="muted">
          {note}
        </AppText>
      )}
    </Card>
  );
}
