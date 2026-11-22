import { AppButton, AppText, Card, Stack } from '../../../shared/ui';
import { useTheme } from '../../../shared/theme/ThemeProvider';
import { changesLine, type CardView } from '../data/weekly-checkin';

/**
 * #3890: the weekly check-in on Home, above the day's workout. Due: one short card with Start review
 * and Later. Saved: one quiet row, "Week reviewed", with See to open the result again.
 */
export function WeeklyCheckinCard({
  view,
  onStart,
  onLater,
  onSee,
}: {
  view: CardView;
  onStart: () => void;
  onLater: () => void;
  onSee: () => void;
}) {
  const { theme } = useTheme();
  if (!view) return null;
  if (view.kind === 'saved') {
    return (
      <Card style={{ paddingVertical: theme.spacing.sm }}>
        <Stack direction="row" align="center" gap="md">
          <Stack gap="xs" style={{ flex: 1, minWidth: 0 }}>
            <AppText variant="subheading">Week reviewed</AppText>
            <AppText variant="caption" tone="muted">
              {changesLine(view.changes, view.openOffers)}
            </AppText>
          </Stack>
          <AppButton
            title="See"
            variant="ghost"
            accessibilityLabel="See what changes next week"
            onPress={onSee}
          />
        </Stack>
      </Card>
    );
  }
  return (
    <Card tone="checkin">
      <AppText variant="eyebrow" style={{ color: theme.tones.checkin.foreground }}>
        Weekly check-in
      </AppText>
      <Stack gap="xs">
        <AppText variant="heading">{view.title}</AppText>
        <AppText variant="body">{view.summary}</AppText>
        <AppText variant="caption" tone="muted">
          1 minute. Tell us how the lifts felt and plan next week.
        </AppText>
      </Stack>
      <Stack direction="row">
        <AppButton title="Start review" onPress={onStart} style={{ flex: 1 }} />
        <AppButton
          title="Later"
          variant="ghost"
          accessibilityLabel="Remind me tomorrow"
          onPress={onLater}
        />
      </Stack>
    </Card>
  );
}
