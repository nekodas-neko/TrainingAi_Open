import { useState } from 'react';
import { Image, Pressable, View } from 'react-native';
import { AppButton, AppText, Badge, Card, Notice, Stack } from '../../../shared/ui';
import { useTheme } from '../../../shared/theme/ThemeProvider';
import { useWorkoutResources } from '../../workouts/data/WorkoutDataProvider';
import { failureNotice } from '../../../core/reporting/index.ts';
import { adminFeedbackSpec, adminPendingPath, type AdminFeedback } from '../data/admin-users';
import { ConfirmSheet } from './ConfirmSheet';

export function AdminFeedbackPanel({
  items,
  timezone,
}: {
  items: readonly AdminFeedback[];
  timezone?: string;
}) {
  const resources = useWorkoutResources();
  const { theme } = useTheme();
  const [open, setOpen] = useState<string | null>(null);
  const [zoomed, setZoomed] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<AdminFeedback | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove(item: AdminFeedback) {
    if (!resources || busy) return;
    setBusy(true);
    setError(null);
    try {
      await resources.write('DELETE', `/api/admin/feedback/${item.id}`, undefined, [
        adminFeedbackSpec.path,
        adminPendingPath,
      ]);
      setOpen(null);
    } catch (failure) {
      setError(failureNotice('Could not delete that feedback.', failure));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Stack>
      {error && <Notice title="Could not do that" message={error} error />}
      {items.length === 0 && (
        <AppText tone="muted" style={{ textAlign: 'center' }}>
          No feedback submissions.
        </AppText>
      )}
      {items.map((item) => {
        const expanded = open === item.id;
        return (
          <Card key={item.id}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${item.type}: ${item.title}`}
              accessibilityState={{ expanded }}
              onPress={() => setOpen(expanded ? null : item.id)}
              style={{ flexDirection: 'row', alignItems: 'flex-start', gap: theme.spacing.md }}
            >
              <Badge label={item.type.toUpperCase()} tone={item.type === 'bug' ? 'heart' : 'neutral'} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <AppText variant="label" numberOfLines={expanded ? undefined : 1}>
                  {item.title}
                </AppText>
                <AppText variant="caption" tone="muted">
                  {item.userEmail} ·{' '}
                  {new Date(item.createdAt).toLocaleString('en-AU', {
                    dateStyle: 'short',
                    timeStyle: 'short',
                    timeZone: timezone,
                  })}
                </AppText>
              </View>
            </Pressable>
            {expanded && (
              <Stack gap="sm">
                {item.description ? <AppText tone="muted">{item.description}</AppText> : null}
                {item.screenshotData?.startsWith('data:image/') ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={zoomed === item.id ? 'Shrink screenshot' : 'Enlarge screenshot'}
                    onPress={() => setZoomed(zoomed === item.id ? null : item.id)}
                  >
                    <Image
                      source={{ uri: item.screenshotData }}
                      accessibilityLabel="Screenshot"
                      resizeMode="contain"
                      style={{
                        width: zoomed === item.id ? '100%' : '50%',
                        aspectRatio: 0.5,
                        borderRadius: theme.radii.small,
                      }}
                    />
                  </Pressable>
                ) : null}
                <AppButton
                  title="Delete"
                  variant="danger"
                  disabled={busy}
                  style={{ alignSelf: 'flex-end' }}
                  onPress={() => setDeleting(item)}
                />
              </Stack>
            )}
          </Card>
        );
      })}
      {deleting && (
        <ConfirmSheet
          title="Delete feedback?"
          message={`Delete "${deleting.title}" from ${deleting.userEmail}? This cannot be undone.`}
          confirmLabel="Delete"
          onClose={() => setDeleting(null)}
          onConfirm={() => void remove(deleting)}
        />
      )}
    </Stack>
  );
}
