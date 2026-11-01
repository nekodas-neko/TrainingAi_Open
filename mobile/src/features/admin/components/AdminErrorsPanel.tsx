import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { AppText, Badge, Card, Stack } from '../../../shared/ui';
import { useTheme } from '../../../shared/theme/ThemeProvider';
import type { AdminErrorEvent } from '../data/admin-monitoring';

export function AdminErrorsPanel({
  events,
  timezone,
}: {
  events: readonly AdminErrorEvent[];
  timezone?: string;
}) {
  const { theme } = useTheme();
  const [open, setOpen] = useState<string | null>(null);
  if (events.length === 0)
    return (
      <AppText tone="muted" style={{ textAlign: 'center' }}>
        No errors recorded — nice.
      </AppText>
    );
  return (
    <Stack>
      {events.map((e) => {
        const expanded = open === e.id;
        return (
          <Card key={e.id}>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ expanded }}
              onPress={() => setOpen(expanded ? null : e.id)}
              style={{ flexDirection: 'row', alignItems: 'flex-start', gap: theme.spacing.md }}
            >
              <Badge label={e.source.toUpperCase()} tone={e.source === 'server' ? 'heart' : 'neutral'} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <AppText variant="label" numberOfLines={expanded ? undefined : 2}>
                  {e.message}
                </AppText>
                <AppText variant="caption" tone="muted">
                  {new Date(e.createdAt).toLocaleString('en-AU', {
                    dateStyle: 'short',
                    timeStyle: 'short',
                    timeZone: timezone,
                  })}
                  {e.userEmail ? ` · ${e.userEmail}` : ''}
                </AppText>
              </View>
            </Pressable>
            {expanded && (e.stack || e.url) ? (
              <Stack gap="xs">
                {e.url ? (
                  <AppText variant="caption" tone="muted" selectable>
                    {e.url}
                  </AppText>
                ) : null}
                {e.stack ? (
                  <AppText variant="caption" tone="muted" selectable>
                    {e.stack}
                  </AppText>
                ) : null}
              </Stack>
            ) : null}
          </Card>
        );
      })}
    </Stack>
  );
}
