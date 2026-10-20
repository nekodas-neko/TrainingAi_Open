import { View } from 'react-native';
import { AppText, Card, Stack } from '../../../shared/ui';
import { useTheme } from '../../../shared/theme/ThemeProvider';
import type { LadderModel } from '../data/view';
import { CatRoster } from './CatRoster';
import { CatSprite } from './CatSprite';

/** One ladder on the collection screen: its stock by tier, the next merge, every cat, the decay line. */
export function LadderCard({ ladder }: { ladder: LadderModel }) {
  const { theme } = useTheme();
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
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'flex-end',
          justifyContent: 'space-around',
        }}
      >
        {ladder.tiers.map((tier, i) => (
          <View
            key={i}
            accessible
            accessibilityLabel={`${tier.count} ${tier.name}`}
            style={{ alignItems: 'center', gap: theme.spacing.xs }}
          >
            <CatSprite faucet={ladder.faucet} tier={i} size={theme.sizes.avatar} />
            <AppText
              variant="caption"
              style={{ fontWeight: '600', fontVariant: ['tabular-nums'] }}
            >
              {tier.count}
            </AppText>
            <AppText variant="micro" tone="muted" style={{ fontWeight: '400' }}>
              {tier.name}
            </AppText>
          </View>
        ))}
      </View>
      {ladder.merge && (
        <AppText variant="caption" tone="muted">
          {ladder.merge}
        </AppText>
      )}
      <CatRoster faucet={ladder.faucet} roster={ladder.roster} more={ladder.more} />
      {ladder.decay && (
        <AppText variant="weekTileDelta" tone="muted">
          {ladder.decay}
        </AppText>
      )}
    </Card>
  );
}
