import { useMemo } from 'react';
import { deltaPct, restByPrescription, type RestSet } from '@trainingai/shared/health/rest-prescription';
import { AppText, Stack } from '../../../shared/ui';
import { useTheme } from '../../../shared/theme/ThemeProvider';

// What the plan prescribes for rest against what the lifter takes, as the current app's Rest
// discipline card prints it (components/health/rest-prescription-card.tsx). The summary comes from
// the shared `restByPrescription`, so both apps answer from one implementation. No colour on the
// difference: red for "less rest" would turn a plain fact into a scorecard.
export function RestPrescriptionSummary({ sets }: { sets: readonly RestSet[] | undefined }) {
  const { theme } = useTheme();
  const summary = useMemo(() => (sets?.length ? restByPrescription([...sets]) : null), [sets]);
  if (!summary) return null;
  const taken = summary.rows.map((row) => row.actualSec);
  const planned = summary.rows.map((row) => row.plannedSec);
  const cell = { fontVariant: ['tabular-nums' as const] };
  return (
    <Stack gap="xs" accessibilityLabel="Your rest against the plan">
      <Stack direction="row" justify="space-between" align="baseline">
        <AppText variant="eyebrow" tone="muted">
          Your rest vs the plan
        </AppText>
        <AppText variant="micro" tone="muted" style={cell}>
          {summary.totalSets} sets · 90 days
        </AppText>
      </Stack>
      <Stack direction="row" gap="sm">
        {['Planned', 'You take', 'Diff', 'Sets'].map((heading, index) => (
          <AppText
            key={heading}
            variant="micro"
            tone="muted"
            style={{ flex: index === 1 ? 2 : 1, textAlign: index < 2 ? 'left' : 'right' }}
          >
            {heading}
          </AppText>
        ))}
      </Stack>
      {summary.rows.map((row) => {
        const diff = deltaPct(row);
        return (
          <Stack
            key={row.plannedSec}
            direction="row"
            gap="sm"
            align="baseline"
            style={{
              borderTopWidth: 1,
              borderColor: theme.colors.border,
              paddingTop: theme.spacing.xs,
            }}
          >
            <AppText variant="caption" tone="muted" style={[{ flex: 1 }, cell]}>
              {row.plannedSec}s
            </AppText>
            <AppText variant="label" style={[{ flex: 2 }, cell]}>
              {row.actualSec}s
            </AppText>
            <AppText variant="caption" tone="muted" style={[{ flex: 1, textAlign: 'right' }, cell]}>
              {diff > 0 ? '+' : diff < 0 ? '−' : ''}
              {Math.abs(diff)}%
            </AppText>
            <AppText variant="micro" tone="muted" style={[{ flex: 1, textAlign: 'right' }, cell]}>
              {row.sets}
            </AppText>
          </Stack>
        );
      })}
      {summary.compressed === true && (
        <AppText variant="micro" tone="muted">
          Your rest sits in a narrower range than the plan asks for — {Math.min(...taken)}–
          {Math.max(...taken)}s taken against {Math.min(...planned)}–{Math.max(...planned)}s
          planned. Worth checking whether the prescriptions are the ones you want.
        </AppText>
      )}
    </Stack>
  );
}
