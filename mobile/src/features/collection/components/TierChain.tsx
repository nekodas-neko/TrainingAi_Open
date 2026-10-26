import { Fragment } from 'react';
import { View } from 'react-native';
import { AppText } from '../../../shared/ui';
import { useTheme } from '../../../shared/theme/ThemeProvider';
import { scaleAlpha } from '../../../shared/theme/alpha';
import type { FaucetKey } from '@trainingai/shared/collection/summary';
import type { LadderModel } from '../data/view';
import { CatSprite } from './CatSprite';

/**
 * The ladder as the thing it is: every tier in a row, and on each link between two the number of the
 * lower one that makes one of the higher. Tiers you hold none of are dimmed, so the empty rungs show
 * how far the ladder goes.
 */
export function TierChain({
  faucet,
  tiers,
}: {
  faucet: FaucetKey;
  tiers: LadderModel['tiers'];
}) {
  const { theme } = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
      {tiers.map((tier, i) => (
        <Fragment key={i}>
          {i > 0 && (
            <View
              accessible
              accessibilityLabel={`${tier.cost} make one`}
              style={{
                flex: 1,
                minWidth: 0,
                alignItems: 'center',
                gap: theme.spacing.xxs,
                // As tall as the sprites, with the line's centre on their midline and the cost
                // just above it, clear of the count and numeral under them.
                height: theme.sizes.chainSprite,
                justifyContent: 'flex-end',
                paddingBottom: (theme.sizes.chainSprite - theme.spacing.xxs) / 2,
              }}
            >
              <AppText variant="micro" tone="muted" style={{ fontVariant: ['tabular-nums'] }}>
                {tier.cost}
              </AppText>
              <View
                style={{
                  alignSelf: 'stretch',
                  height: theme.spacing.xxs,
                  borderRadius: theme.radii.swatch,
                  // The track is near the card colour in dark; muted at 35% shows in both modes.
                  backgroundColor: scaleAlpha(theme.colors.muted, 0.35),
                }}
              />
            </View>
          )}
          <View
            accessible
            accessibilityLabel={`${tier.count} ${tier.name}`}
            style={{
              width: theme.sizes.chainRung,
              alignItems: 'center',
              gap: theme.spacing.xxs,
              opacity: tier.count > 0 ? 1 : 0.35,
            }}
          >
            <CatSprite faucet={faucet} tier={i} size={theme.sizes.chainSprite} />
            <AppText
              variant="caption"
              style={{ fontWeight: tier.count > 0 ? '600' : '400', fontVariant: ['tabular-nums'] }}
            >
              {tier.count}
            </AppText>
            <AppText variant="micro" tone="muted" style={{ fontWeight: '400' }}>
              {tier.numeral}
            </AppText>
          </View>
        </Fragment>
      ))}
    </View>
  );
}
