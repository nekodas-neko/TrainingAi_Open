import { View } from 'react-native';
import { seasonBadgeTier } from '@trainingai/shared/achievement-display';
import { AppText, Card } from '../../../shared/ui';
import { useTheme } from '../../../shared/theme/ThemeProvider';
import type { Season } from '../data/models';
import { seasonBadges } from '../data/view';

/** More › Profile › Season Badges: one chip per season the player has a result in, in its medal's colour. */
export function SeasonBadges({ seasons }: { seasons: Season[] }) {
  const { theme } = useTheme();
  const badges = seasonBadges(seasons);
  if (badges.length === 0) return null;
  return (
    <Card>
      <AppText variant="eyebrow" tone="muted">
        Season Badges
      </AppText>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm }}>
        {badges.map((season) => {
          const color = theme.rewards.tiers[seasonBadgeTier(season.result.badgeLabel)];
          return (
            <View
              key={season.id}
              accessible
              accessibilityLabel={`${season.label}, ${season.result.badgeLabel}`}
              style={{
                borderRadius: theme.radii.control,
                borderWidth: 1,
                borderColor: color,
                backgroundColor: theme.colors.raised,
                paddingHorizontal: theme.spacing.md,
                paddingVertical: theme.spacing.xs + theme.spacing.xxs,
              }}
            >
              <AppText variant="caption" style={{ color, fontWeight: '600' }}>
                {season.label}
              </AppText>
            </View>
          );
        })}
      </View>
    </Card>
  );
}
