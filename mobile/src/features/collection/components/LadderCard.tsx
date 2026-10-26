import { View } from 'react-native';
import { AppText, Card, Stack } from '../../../shared/ui';
import type { LadderModel } from '../data/view';
import { CatRoster } from './CatRoster';
import { TierChain } from './TierChain';

/** One ladder on the collection screen: its tier chain, the next merge, the cats behind a tap, the decay line. */
export function LadderCard({ ladder }: { ladder: LadderModel }) {
  return (
    <Card>
      <Stack direction="row" align="baseline" justify="space-between">
        <AppText variant="subheading" style={{ flexShrink: 1 }}>
          {ladder.title}
          {ladder.provisional && (
            <AppText variant="micro" tone="muted" style={{ fontWeight: '400' }}>
              {'  '}provisional
            </AppText>
          )}
        </AppText>
        <AppText variant="caption" tone="muted">
          {ladder.held}
        </AppText>
      </Stack>
      <TierChain faucet={ladder.faucet} tiers={ladder.tiers} />
      {ladder.merge && (
        <AppText variant="caption" tone="muted">
          {ladder.merge}
        </AppText>
      )}
      <CatRoster
        faucet={ladder.faucet}
        roster={ladder.roster}
        more={ladder.more}
        total={ladder.total}
        note={ladder.decay}
      />
    </Card>
  );
}
