import { Pressable, Image, View } from 'react-native';
import { AppText, AttentionDot, IconButton, Stack, StatusIndicator } from '../../../shared/ui';
import { useTheme } from '../../../shared/theme/ThemeProvider';
import { homeGreeting, profileDisplayName } from '@trainingai/shared/greeting';
import { WeatherChip } from '../../weather/components/WeatherChip';
export function HomeHeader({
  today,
  timezone,
  user,
  error,
  pending,
  refreshing,
  onRefresh,
  onLayout,
  onProfile,
  editing = false,
  avatar,
  badge = 0,
}: {
  today: string;
  timezone: string;
  user?: { displayName?: string | null; name?: string | null } | null;
  error: string | null;
  pending: boolean;
  refreshing: boolean;
  onRefresh: () => void;
  onLayout: () => void;
  onProfile: () => void;
  editing?: boolean;
  avatar?: string | null;
  /** Pending signups and feedback for an admin; nothing is drawn at 0. */
  badge?: number;
}) {
  const { theme } = useTheme();
  const date = new Intl.DateTimeFormat('en-AU', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  }).format(new Date(today + 'T12:00:00Z'));
  return (
    <Stack direction="row" align="center" justify="space-between">
      <Stack gap="xxs" style={{ flex: 1 }}>
        <WeatherChip />
        <AppText variant="caption" tone="muted" numberOfLines={1}>
          {date}
        </AppText>
        <AppText variant="pageTitle" numberOfLines={2}>
          {homeGreeting(user, timezone)}
        </AppText>
      </Stack>
      <Stack direction="row" gap="none" align="center">
        <IconButton
          icon="layout"
          label="Reorder sections"
          selected={editing}
          tone={editing ? 'brand' : 'muted'}
          onPress={onLayout}
        />
        {error || pending ? (
          <StatusIndicator
            label="Home records"
            error={error}
            message={pending ? 'Saved on this phone. Waiting to sync.' : null}
            busy={refreshing}
            onRetry={error ? onRefresh : undefined}
          />
        ) : (
          <IconButton
            icon="refresh"
            label="Refresh Home"
            busy={refreshing}
            onPress={onRefresh}
          />
        )}
        <View>
          <Pressable
            onPress={onProfile}
            accessibilityRole="button"
            accessibilityLabel={badge > 0 ? `Profile, ${badge} waiting` : 'Profile'}
            style={{
              width: theme.sizes.touchTarget,
              height: theme.sizes.touchTarget,
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: theme.radii.pill,
              borderWidth: 1,
              borderColor: theme.colors.brandBorder,
              backgroundColor: theme.colors.brandSurface,
            }}
          >
            {avatar ? (
              <Image
                alt=""
                source={{ uri: avatar }}
                style={{
                  width: theme.sizes.touchTarget,
                  height: theme.sizes.touchTarget,
                  borderRadius: theme.radii.pill,
                }}
              />
            ) : (
              <AppText variant="label" tone="brand">
                {profileDisplayName(user)
                  ?.trim()
                  .split(/\s+/)
                  .map((part) => part[0])
                  .slice(0, 2)
                  .join('')
                  .toUpperCase() || 'TA'}
              </AppText>
            )}
          </Pressable>
          {badge > 0 && <AttentionDot count={badge} />}
        </View>
      </Stack>
    </Stack>
  );
}
