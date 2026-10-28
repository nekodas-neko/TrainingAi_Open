import { useEffect, useRef, useState } from 'react';
import { Pressable, View } from 'react-native';
import {
  AppButton,
  AppText,
  DisclosureIcon,
  Grid,
  LoadingIndicator,
  Stack,
} from '../../../shared/ui';
import { useTheme } from '../../../shared/theme/ThemeProvider';
import type { Achievement, Rewards } from '../data/models';
import {
  achievementCounts,
  achievementGroups,
  recentUnlocked,
  unseenUnlocks,
} from '../data/view';
import { useSeenAchievements } from '../data/useRewards';
import { AchievementBadge } from './AchievementBadge';
import { AchievementDetail } from './AchievementDetail';

/** More › Profile › Achievements: a four-badge preview that opens into every category. */
export function AchievementsSection({
  rewards,
  loading,
}: {
  rewards: Rewards | null;
  loading: boolean;
}) {
  const { theme } = useTheme();
  const [expanded, setExpanded] = useState(false);
  const [selected, setSelected] = useState<Achievement | null>(null);
  const counts = rewards ? achievementCounts(rewards.achievements) : null;
  const recent = rewards ? recentUnlocked(rewards.achievements) : [];
  return (
    <View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Achievements"
        accessibilityHint={
          counts ? `${counts.unlocked} of ${counts.total} unlocked` : undefined
        }
        accessibilityState={{ expanded }}
        onPress={() => setExpanded((open) => !open)}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          minHeight: theme.sizes.touchTarget,
          paddingHorizontal: theme.spacing.xxs,
        }}
      >
        <AppText variant="eyebrow" tone="muted">
          Achievements
        </AppText>
        <Stack direction="row" align="center" gap="sm">
          <AppText variant="micro" tone="brand">
            {counts ? `${counts.unlocked} / ${counts.total}` : '— / —'}
          </AppText>
          <DisclosureIcon expanded={expanded} collapsed="right" size={theme.sizes.iconCompact} />
        </Stack>
      </Pressable>
      {loading && !rewards ? (
        <View style={{ alignItems: 'center', paddingVertical: theme.spacing.xxl }}>
          <LoadingIndicator />
        </View>
      ) : !rewards ? (
        <AppText
          tone="muted"
          style={{ textAlign: 'center', paddingVertical: theme.spacing.lg }}
        >
          Could not load achievements
        </AppText>
      ) : expanded ? (
        <Stack gap="md">
          <AppButton
            title="← Collapse"
            variant="surface"
            onPress={() => setExpanded(false)}
          />
          <AchievementGrid achievements={rewards.achievements} onSelect={setSelected} />
        </Stack>
      ) : recent.length === 0 ? (
        <View
          style={{
            borderRadius: theme.radii.card,
            borderWidth: 1,
            borderColor: theme.colors.border,
            backgroundColor: theme.colors.raised,
            padding: theme.spacing.lg,
          }}
        >
          <AppText variant="caption" tone="muted">
            Complete your first workout to earn achievements!
          </AppText>
        </View>
      ) : (
        <Grid columns={4} gap="snug">
          {recent.map((row) => (
            <AchievementBadge key={row.id} achievement={row} onPress={setSelected} />
          ))}
        </Grid>
      )}
      <AchievementDetail achievement={selected} onClose={() => setSelected(null)} />
    </View>
  );
}

// Opening the grid is what marks unlocks as seen: tiles unlocked since the last open shimmer once.
function AchievementGrid({
  achievements,
  onSelect,
}: {
  achievements: Achievement[];
  onSelect: (achievement: Achievement) => void;
}) {
  const { theme } = useTheme();
  const { seen, mark } = useSeenAchievements();
  const [fresh, setFresh] = useState<ReadonlySet<string>>(new Set());
  const taken = useRef(false);
  useEffect(() => {
    if (seen === null || taken.current) return;
    taken.current = true;
    const ids = unseenUnlocks(achievements, seen);
    setFresh(new Set(ids));
    if (ids.length) void mark(ids);
  }, [seen, achievements, mark]);
  return (
    <Stack gap="xxl">
      {achievementGroups(achievements).map((group) => (
        <View key={group.category}>
          <Stack
            direction="row"
            justify="space-between"
            style={{
              paddingHorizontal: theme.spacing.xxs,
              marginBottom: theme.spacing.sm,
            }}
          >
            <AppText variant="eyebrow" tone="muted">
              {group.category}
            </AppText>
            <AppText variant="micro" tone="muted">
              {group.unlocked} / {group.items.length}
            </AppText>
          </Stack>
          <Grid columns={4} gap="snug">
            {group.items.map((row) => (
              <AchievementBadge
                key={row.id}
                achievement={row}
                isNew={fresh.has(row.id)}
                onPress={onSelect}
              />
            ))}
          </Grid>
        </View>
      ))}
    </Stack>
  );
}
