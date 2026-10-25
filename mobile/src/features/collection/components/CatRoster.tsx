import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { AppText, Stack } from '../../../shared/ui';
import { layoutMotion } from '../../../shared/ui/layoutMotion';
import { useReducedMotion } from '../../../shared/ui/useReducedMotion';
import { useTheme } from '../../../shared/theme/ThemeProvider';
import type { FaucetKey } from '@trainingai/shared/collection/summary';
import type { LadderModel } from '../data/view';
import { CatSprite } from './CatSprite';

/**
 * Every cat on a ladder by name, its tier and the day it arrived, behind a "Show all N" so a ladder
 * is one glance until you ask for the cats. The names are the replay's own, so a cat here is the
 * same cat wandering in the Home pen.
 */
export function CatRoster({
  faucet,
  roster,
  more,
  total,
  note,
}: Pick<LadderModel, 'roster' | 'more' | 'total'> & {
  faucet: FaucetKey;
  /** A line that shares the toggle's row, so it costs no height of its own. */
  note: string | null;
}) {
  const { theme } = useTheme();
  const reduced = useReducedMotion();
  const [open, setOpen] = useState(false);
  if (roster.length === 0 && !note) return null;
  const toggle = () => {
    layoutMotion(reduced);
    setOpen(!open);
  };
  return (
    <View>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          columnGap: theme.spacing.md,
          rowGap: theme.spacing.xs,
        }}
      >
        {roster.length > 0 && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={open ? 'Hide cats' : `Show all ${total} cats`}
          accessibilityState={{ expanded: open }}
          hitSlop={theme.spacing.sm}
          onPress={toggle}
          style={({ pressed }) => ({
            paddingHorizontal: theme.spacing.md,
            paddingVertical: theme.spacing.sm - theme.spacing.xxs,
            borderRadius: theme.radii.pill,
            backgroundColor: theme.colors.raised,
            opacity: pressed ? 0.7 : 1,
          })}
        >
          <AppText variant="caption" style={{ fontWeight: '600' }}>
            {open ? 'Hide' : `Show all ${total}`}
          </AppText>
        </Pressable>
        )}
        {note && (
          <AppText variant="weekTileDelta" tone="muted" style={{ flexShrink: 1 }}>
            {note}
          </AppText>
        )}
      </View>
      {open && (
        <View style={{ alignSelf: 'stretch', gap: theme.spacing.sm, marginTop: theme.spacing.md }}>
          {roster.map((cat) => (
            <Stack key={cat.id} direction="row" align="center" gap="sm">
              <CatSprite faucet={faucet} tier={cat.tier} size={theme.sizes.rosterSprite} />
              <AppText
                variant="caption"
                numberOfLines={1}
                style={{ flex: 1, minWidth: 0, fontWeight: '600' }}
              >
                {cat.name}
              </AppText>
              <AppText variant="micro" tone="muted" style={{ fontWeight: '400' }}>
                {cat.tierName}
              </AppText>
              <AppText variant="micro" tone="muted" style={{ fontWeight: '400' }}>
                {cat.detail}
              </AppText>
            </Stack>
          ))}
          {more > 0 && (
            <AppText variant="micro" tone="muted" style={{ fontWeight: '400' }}>
              +{more} more
            </AppText>
          )}
        </View>
      )}
    </View>
  );
}
