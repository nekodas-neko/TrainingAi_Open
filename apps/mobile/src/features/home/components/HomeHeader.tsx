import { Pressable, Image } from 'react-native';
import { AppText, IconButton, Stack, StatusIndicator } from '../../../shared/ui';
import { useTheme } from '../../../shared/theme/ThemeProvider';
import { greeting } from '../data/models';
export function HomeHeader({
  today,
  timezone,
  name,
  error,
  pending,
  refreshing,
  onRefresh,
  onLayout,
  onProfile,
  editing = false,
  avatar,
}: {
  today: string;
  timezone: string;
  name?: string | null;
  error: string | null;
  pending: boolean;
  refreshing: boolean;
  onRefresh: () => void;
  onLayout: () => void;
  onProfile: () => void;
  editing?: boolean;
  avatar?: string | null;
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
        <AppText variant="caption" tone="muted">
          {date}
        </AppText>
        <AppText variant="pageTitle" numberOfLines={2}>
          {greeting(name, timezone)}
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
        <Pressable
          onPress={onProfile}
          accessibilityRole="button"
          accessibilityLabel="Profile"
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
              {name
                ?.trim()
                .split(/\s+/)
                .map((part) => part[0])
                .slice(0, 2)
                .join('')
                .toUpperCase() || 'TA'}
            </AppText>
          )}
        </Pressable>
      </Stack>
    </Stack>
  );
}
