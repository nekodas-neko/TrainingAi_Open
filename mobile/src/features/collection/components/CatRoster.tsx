import { View } from 'react-native';
import { AppText, Stack } from '../../../shared/ui';
import { useTheme } from '../../../shared/theme/ThemeProvider';
import type { FaucetKey } from '@trainingai/shared/collection/summary';
import type { LadderModel } from '../data/view';
import { CatSprite } from './CatSprite';

/**
 * Every cat on a ladder by name: its tier, the day it arrived, and the cats it was made from. The
 * names are the replay's own, so a cat here is the same cat wandering in the Home pen.
 */
export function CatRoster({
  faucet,
  roster,
  more,
}: Pick<LadderModel, 'roster' | 'more'> & { faucet: FaucetKey }) {
  const { theme } = useTheme();
  if (roster.length === 0) return null;
  return (
    <View
      style={{
        marginTop: theme.spacing.md,
        gap: theme.spacing.sm - theme.spacing.xxs,
        borderTopWidth: 1,
        borderTopColor: theme.colors.border,
        paddingTop: theme.spacing.md,
      }}
    >
      {roster.map((cat) => (
        <Stack key={cat.id} direction="row" align="center" gap="sm">
          <CatSprite faucet={faucet} tier={cat.tier} size={28} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <AppText variant="caption" numberOfLines={1} style={{ fontWeight: '600' }}>
              {cat.name}{' '}
              <AppText variant="caption" tone="muted" style={{ fontWeight: '400' }}>
                · {cat.tierName}
              </AppText>
            </AppText>
            <AppText
              variant="micro"
              tone="muted"
              numberOfLines={1}
              style={{ fontWeight: '400' }}
            >
              {cat.detail}
            </AppText>
          </View>
        </Stack>
      ))}
      {more > 0 && (
        <AppText variant="micro" tone="muted" style={{ fontWeight: '400' }}>
          +{more} more
        </AppText>
      )}
    </View>
  );
}
