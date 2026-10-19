import { plural } from '@trainingai/shared/format/plural';
import { levelProgress } from '@trainingai/shared/achievement-display';
import { useState } from 'react';
import { z } from 'zod';
import {
  AppText,
  Avatar,
  Badge,
  Card,
  Grid,
  Icon,
  PageLayout,
  ProgressBar,
  Sheet,
  StableContent,
  Stack,
  StatusIndicator,
  StateCard,
  AppButton,
} from '../../../shared/ui';
import { useTheme } from '../../../shared/theme/ThemeProvider';
import { useWorkoutResource } from '../../workouts/data/WorkoutDataProvider';
import { friendProfileSpec, titleLabel, achievementSchema } from '../data/models';
export function FriendProfileScreen({
  userId,
  onBack,
}: {
  userId: string;
  onBack: () => void;
}) {
  const valid = z.uuid().safeParse(userId);
  return valid.success ? (
    <Profile userId={valid.data} onBack={onBack} />
  ) : (
    <PageLayout title="Profile" onBack={onBack}>
      <StateCard title="Profile unavailable" message="This profile address is invalid." />
    </PageLayout>
  );
}
function Profile({ userId, onBack }: { userId: string; onBack: () => void }) {
  const state = useWorkoutResource(friendProfileSpec(userId)),
    profile = state.data,
    { theme } = useTheme();
  const [selected, setSelected] = useState<z.infer<typeof achievementSchema> | null>(null);
  const xpProgress = profile
    ? levelProgress(profile.xp, profile.currentLevelXp, profile.nextLevelXp)
    : 0;
  const trophies =
    profile?.achievements.filter(
      (row) => profile.trophyCase.includes(row.id) && row.unlocked,
    ) ?? [];
  const unlocked = profile?.achievements.filter((row) => row.unlocked) ?? [];
  return (
    <PageLayout
      title="Profile"
      onBack={onBack}
      scroll
      actions={
        <StatusIndicator
          label="Friend profile"
          error={state.error}
          busy={state.refreshing}
          onRetry={state.refresh}
        />
      }
    >
      <StableContent minHeight={600} loading={!profile && state.loading}>
        {!profile ? (
          <StateCard
            title="Profile unavailable"
            message={
              state.error?.includes('account')
                ? 'This profile is visible to accepted friends only.'
                : 'Could not load this profile. Check your connection and retry.'
            }
            action="Retry"
            onAction={state.refresh}
          />
        ) : (
          <>
            <Stack align="center" gap="sm">
              <Avatar
                name={profile.displayName ?? profile.name ?? '?'}
                uri={profile.avatar}
                size={theme.sizes.scoreChip}
              />
              <AppText variant="hero">
                {profile.displayName ?? profile.name ?? 'Friend'}
              </AppText>
              {profile.equippedTitle && <Badge label={titleLabel(profile.equippedTitle)!} />}
              <AppText variant="micro" tone="muted">
                {profile.friendCode ?? ''}
              </AppText>
              <Card tone="brand">
                <AppText variant="label">
                  Level {profile.level} · {profile.levelLabel}
                </AppText>
                <AppText variant="micro" tone="muted">
                  {profile.xp.toLocaleString()} XP total
                </AppText>
              </Card>
            </Stack>
            <Stack gap="xs">
              <ProgressBar value={xpProgress} />
              <Stack direction="row" justify="space-between">
                <AppText variant="micro" tone="muted">
                  {profile.xp.toLocaleString()} XP
                </AppText>
                <AppText variant="micro" tone="muted">
                  {profile.nextLevelXp > profile.xp
                    ? `${(profile.nextLevelXp - profile.xp).toLocaleString()} to next level`
                    : 'Max level'}
                </AppText>
              </Stack>
            </Stack>
            <Grid columns={profile.totalDistanceKm > 0 ? 4 : 3} gap="xs">
              {[
                ['Sessions', profile.lifetimeSessions.toLocaleString()],
                [
                  'Volume',
                  profile.lifetimeVolumeKg >= 1000
                    ? `${(profile.lifetimeVolumeKg / 1000).toFixed(1)}T`
                    : `${Math.round(profile.lifetimeVolumeKg)}kg`,
                ],
                ['Best streak', plural(profile.bestStreak, 'day', 'days')],
                ...(profile.totalDistanceKm > 0
                  ? [['Distance', `${profile.totalDistanceKm.toFixed(1)}km`]]
                  : []),
              ].map(([label, value]) => (
                <Card key={label}>
                  <AppText variant="heading" numberOfLines={1} adjustsFontSizeToFit>
                    {value}
                  </AppText>
                  <AppText variant="micro" tone="muted">
                    {label}
                  </AppText>
                </Card>
              ))}
            </Grid>
            <Card>
              <AppText variant="eyebrow" tone="muted">
                Trophy Case
              </AppText>
              {trophies.length ? (
                <Grid columns={3} gap="sm">
                  {trophies.map((row) => (
                    <AppButton
                      key={row.id}
                      title={row.name}
                      variant="surface"
                      icon="award"
                      onPress={() => setSelected(row)}
                    />
                  ))}
                </Grid>
              ) : (
                <AppText variant="caption" tone="muted">
                  No trophies showcased yet.
                </AppText>
              )}
            </Card>
            <Card>
              <AppText variant="heading">Unlocked achievements</AppText>
              {unlocked.length ? (
                <Grid columns={3} gap="sm">
                  {unlocked.map((row) => (
                    <AppButton
                      key={row.id}
                      title={row.name}
                      variant="surface"
                      icon="award"
                      onPress={() => setSelected(row)}
                    />
                  ))}
                </Grid>
              ) : (
                <AppText variant="caption" tone="muted">
                  No achievements unlocked yet.
                </AppText>
              )}
            </Card>
          </>
        )}
      </StableContent>
      <Sheet
        visible={selected !== null}
        title={selected?.name ?? 'Achievement'}
        onClose={() => setSelected(null)}
      >
        {selected && (
          <>
            <Icon name="award" tone="brand" />
            <AppText>{selected.description}</AppText>
            <AppText variant="caption">
              {Math.min(selected.current, selected.goal).toLocaleString()} /{' '}
              {selected.goal.toLocaleString()}
            </AppText>
            <ProgressBar value={selected.goal > 0 ? selected.current / selected.goal : 0} />
            <AppText variant="label">+{selected.xpReward} XP</AppText>
          </>
        )}
      </Sheet>
    </PageLayout>
  );
}
