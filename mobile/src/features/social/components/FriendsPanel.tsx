import { timeAgo } from '@trainingai/shared/format/time-ago';
import { useState } from 'react';
import { Pressable } from 'react-native';
import {
  AppButton,
  AppText,
  Avatar,
  Badge,
  Card,
  Icon,
  SegmentedControl,
  StableContent,
  Stack,
  StatusIndicator,
  StateCard,
} from '../../../shared/ui';
import { useTheme } from '../../../shared/theme/ThemeProvider';
import { useWorkoutResource } from '../../workouts/data/WorkoutDataProvider';
import {
  feedSpec,
  feedText,
  friendsSpec,
  leaderboardSpec,
  pendingRequests,
  rankLabel,
  rankValue,
  titleLabel,
  type Metric,
  type Period,
} from '../data/models';
import { ManageFriendsSheet } from './ManageFriendsSheet';
function relative(iso: string) {
  return timeAgo(iso) ?? 'Date unavailable';
}
export function FriendsPanel({ openProfile }: { openProfile: (id: string) => void }) {
  const { theme } = useTheme();
  const [view, setView] = useState('feed'),
    [manage, setManage] = useState(false),
    [period, setPeriod] = useState<Period>('weekly'),
    [metric, setMetric] = useState<Metric>('sessions');
  const friends = useWorkoutResource(friendsSpec),
    feed = useWorkoutResource(feedSpec, view === 'feed'),
    leaderboard = useWorkoutResource(leaderboardSpec, view === 'leaderboard');
  const rows = friends.data?.friendships ?? [],
    pending = pendingRequests(rows).incoming.length;
  const status = view === 'feed' ? feed : leaderboard;
  const entries = [...(leaderboard.data?.entries ?? [])].sort(
    (a, b) => rankValue(b, period, metric) - rankValue(a, period, metric),
  );
  const mine = entries.find((row) => row.isSelf),
    myValue = mine ? rankValue(mine, period, metric) : 0;
  return (
    <>
      <Stack direction="row" align="center">
        <Stack style={{ flex: 1 }}>
          <SegmentedControl
            label="Friends views"
            value={view}
            onChange={setView}
            options={[
              { value: 'feed', label: 'Activity' },
              { value: 'leaderboard', label: 'Leaderboard' },
            ]}
          />
        </Stack>
        <AppButton
          title={`Manage${pending ? ` (${pending})` : ''}`}
          icon="users"
          variant="surface"
          onPress={() => setManage(true)}
        />
      </Stack>
      <Stack direction="row" justify="space-between" align="center">
        <AppText variant="eyebrow" tone="muted">
          {view === 'feed' ? 'Friend activity' : 'Leaderboard'}
        </AppText>
        <StatusIndicator
          label="Community"
          busy={status.refreshing || friends.refreshing}
          error={status.error ?? friends.error}
          onRetry={() => {
            friends.refresh();
            status.refresh();
          }}
        />
      </Stack>
      {!friends.connected ? (
        <StateCard
          title="Connect your account"
          message="Sign in to add friends and share your progress."
        />
      ) : (
        <>
          {view === 'leaderboard' && (
            <>
              <SegmentedControl
                label="Leaderboard period"
                value={period}
                onChange={(value) => setPeriod(value as Period)}
                options={[
                  { value: 'weekly', label: 'This Week' },
                  { value: 'alltime', label: 'All Time' },
                ]}
              />
              <SegmentedControl
                label="Leaderboard metric"
                value={metric}
                onChange={(value) => setMetric(value as Metric)}
                options={[
                  { value: 'sessions', label: 'Sessions' },
                  { value: 'volume', label: 'Volume' },
                  { value: 'streak', label: 'Streak' },
                ]}
              />
            </>
          )}
          <StableContent minHeight={220} loading={status.loading && !status.data}>
            {status.error && !status.data ? (
              <StateCard
                title={
                  view === 'feed'
                    ? 'Could not load friend activity'
                    : 'Could not load the leaderboard'
                }
                message="Check your connection and retry."
                action="Retry"
                onAction={status.refresh}
              />
            ) : view === 'feed' ? (
              feed.data?.events.length ? (
                feed.data.events.map((event, index) => (
                  <Pressable
                    key={`${event.userId}:${event.occurredAt}:${index}`}
                    accessibilityRole="button"
                    accessibilityLabel={`${event.displayName}: ${feedText(event)}`}
                    onPress={() => openProfile(event.userId)}
                    style={{
                      borderBottomWidth: 1,
                      borderBottomColor: theme.colors.border,
                      paddingVertical: theme.spacing.md,
                    }}
                  >
                    <Stack direction="row" align="flex-start">
                      <Avatar
                        name={event.displayName}
                        uri={event.avatar}
                        size={theme.sizes.touchTarget}
                      />
                      <Stack style={{ flex: 1 }} gap="xs">
                        <Stack direction="row" align="center" wrap>
                          <AppText variant="label">{event.displayName}</AppText>
                          {event.equippedTitle && (
                            <Badge label={titleLabel(event.equippedTitle)!} />
                          )}
                        </Stack>
                        <Stack direction="row" align="center">
                          <Icon
                            name={event.type === 'pr' ? 'upper' : 'trophy'}
                            color={event.type === 'pr' ? theme.friends.purple : theme.friends.gold}
                          />
                          <AppText variant="caption" style={{ flex: 1 }}>
                            {feedText(event)}
                          </AppText>
                        </Stack>
                        <AppText variant="micro" tone="muted">
                          {relative(event.occurredAt)}
                        </AppText>
                      </Stack>
                    </Stack>
                  </Pressable>
                ))
              ) : (
                <StateCard
                  title="No friend activity yet"
                  message="Add friends to see their progress here."
                />
              )
            ) : entries.length ? (
              entries.map((entry, index) => {
                const value = rankValue(entry, period, metric),
                  chasing =
                    !entry.isSelf &&
                    value > 0 &&
                    myValue > 0 &&
                    Math.abs(value - myValue) / Math.max(value, myValue) < 0.1;
                return (
                  <Pressable
                    key={entry.userId}
                    accessibilityRole="button"
                    accessibilityLabel={`Rank ${index + 1}, ${entry.displayName}${entry.isSelf ? ', you' : ''}, ${rankLabel(value, period, metric)}`}
                    onPress={() => openProfile(entry.userId)}
                  >
                    <Card tone={entry.isSelf ? 'brand' : 'neutral'}>
                      <Stack direction="row" align="center">
                        <AppText variant="label">{index + 1}</AppText>
                        <Avatar
                          name={entry.displayName}
                          uri={entry.avatar}
                          size={theme.sizes.touchTarget}
                        />
                        <Stack style={{ flex: 1 }} gap="xxs">
                          <AppText variant="label">
                            {entry.displayName}
                            {entry.isSelf ? ' (you)' : ''}
                          </AppText>
                          {entry.equippedTitle && (
                            <AppText variant="micro" tone="brand">
                              {titleLabel(entry.equippedTitle)}
                            </AppText>
                          )}
                          {chasing && (
                            <AppText variant="micro" tone="muted">
                              Closing in on you
                            </AppText>
                          )}
                        </Stack>
                        <AppText variant="caption">{rankLabel(value, period, metric)}</AppText>
                        {index === 0 && <Icon name="award" color={theme.friends.gold} />}
                      </Stack>
                    </Card>
                  </Pressable>
                );
              })
            ) : (
              <StateCard
                title="No data yet"
                message="Your friends’ training will appear here."
              />
            )}
          </StableContent>
        </>
      )}
      <ManageFriendsSheet
        visible={manage}
        onClose={() => setManage(false)}
        rows={rows}
        openProfile={openProfile}
      />
    </>
  );
}
