import { capitalize } from '@trainingai/shared/format/capitalize';
import { AppText, Card, Icon, Stack } from '../../../shared/ui';
import { useTheme } from '../../../shared/theme/ThemeProvider';

/**
 * The Resilience line on the Readiness screen: a compact shield-and-text note, as the current
 * app's resilience-tile.tsx draws it, not a metric card with a big value. It states the level and
 * band, how stale the level is, whether it is still building, or why none is published yet.
 */
export function ResilienceNote({
  level,
  band,
  confidence,
  asOf,
  shortfall,
}: {
  level: number | null;
  band: string | null;
  confidence: number | null;
  asOf: string | null;
  shortfall: string | null;
}) {
  const { theme } = useTheme();
  const hasLevel = level != null && band != null;
  const learning = hasLevel && confidence != null && confidence < 1;
  return (
    <Card
      style={{
        paddingHorizontal: theme.spacing.md,
        paddingVertical: 10,
        borderRadius: theme.radii.control,
        gap: 0,
      }}
    >
      <Stack direction="row" gap="sm" align="flex-start">
        <Icon name="shield" size={16} style={{ marginTop: 2 }} />
        <Stack gap="none" style={{ flex: 1 }}>
          <AppText variant="caption">
            <AppText variant="caption" style={{ fontWeight: '600' }}>
              Resilience
            </AppText>
            <AppText variant="caption" tone="muted">
              {hasLevel ? ` · ${capitalize(band)} (${level.toFixed(1)})` : ' · Not published yet'}
            </AppText>
          </AppText>
          {hasLevel && asOf && (
            <AppText variant="caption" tone="muted">
              {asOf}
            </AppText>
          )}
          {learning && (
            <AppText variant="caption" tone="muted">
              Still building — based on {Math.round(confidence * 14)} of the last 14 days.
            </AppText>
          )}
          {shortfall && (
            <AppText variant="caption" tone="muted">
              {shortfall}
            </AppText>
          )}
        </Stack>
      </Stack>
    </Card>
  );
}
