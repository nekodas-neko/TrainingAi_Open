import { useTheme } from '../../../shared/theme/ThemeProvider';
import { AppButton, AppText, Stack, TouchSurface } from '../../../shared/ui';
import { SessionGlyph } from '../../workouts/components/SessionGlyph';
import { APPLY_PRIOR_DATA_LABEL, periodizationRow } from '../data/training-view';

/**
 * One AI Periodization row: the tappable session card, and beside it the optional "use prior
 * data" button. The card's `flex: 1` has to reach the row through TouchSurface's wrapper (#4067).
 */
export function PeriodizationRow({
  session,
  phaseColors,
  busy,
  disabled,
  onOpen,
  onApplyPriorData,
}: {
  session: Parameters<typeof periodizationRow>[0] & { sessionId: string; sessionName: string; icon?: string | null };
  phaseColors: Record<string, string>;
  busy: boolean;
  disabled: boolean;
  onOpen: () => void;
  onApplyPriorData: () => void;
}) {
  const { theme } = useTheme();
  const row = periodizationRow(session);
  return (
    <Stack direction="row" align="center" gap="sm">
      <TouchSurface
        style={{ flex: 1, minWidth: 0 }}
        accessibilityRole="button"
        accessibilityLabel={`${session.sessionName}, ${row.label}`}
        onPress={onOpen}
      >
        <Stack
          direction="row"
          align="center"
          gap="md"
          style={{
            borderRadius: theme.radii.control,
            backgroundColor: `${theme.colors.background}99`,
            paddingHorizontal: theme.spacing.md,
            paddingVertical: theme.spacing.sm,
          }}
        >
          <SessionGlyph
            icon={session.icon}
            position={0}
            size={theme.sizes.iconCompact}
            color={theme.colors.muted}
          />
          <Stack gap="none" style={{ flex: 1, minWidth: 0 }}>
            <AppText variant="label" numberOfLines={1}>
              {session.sessionName}
            </AppText>
            <AppText variant="micro" style={{ color: phaseColors[row.phase] }}>
              {row.label}
            </AppText>
          </Stack>
          {row.recency ? (
            <AppText variant="micro" tone="muted">
              {row.recency}
            </AppText>
          ) : null}
        </Stack>
      </TouchSurface>
      {row.needsBaseline && (
        <AppButton
          title={APPLY_PRIOR_DATA_LABEL}
          variant="ghost"
          textVariant="micro"
          busy={busy}
          disabled={disabled}
          accessibilityLabel={`Use prior data for ${session.sessionName}`}
          onPress={onApplyPriorData}
        />
      )}
    </Stack>
  );
}
