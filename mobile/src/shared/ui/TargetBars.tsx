import { AppText } from './AppText';
import { ProgressBar } from './ProgressBar';
import { Stack } from './Stack';
export function TargetBars({
  rows,
  label,
}: {
  rows: readonly {
    label: string;
    actual: number | null;
    target: number | null;
    unit: string;
    color?: string;
  }[];
  label: string;
}) {
  return (
    <Stack accessibilityLabel={label}>
      {rows.map((row) => (
        <Stack key={row.label} gap="xs">
          <Stack direction="row" justify="space-between">
            <AppText variant="micro">{row.label}</AppText>
            <AppText variant="micro" tone="muted">
              {row.actual == null ? '—' : Math.round(row.actual)}
              {row.target != null ? ' / ' + Math.round(row.target) : ''} {row.unit}
            </AppText>
          </Stack>
          <ProgressBar
            value={
              row.actual != null && row.target != null && row.target > 0
                ? row.actual / row.target
                : 0
            }
            color={row.color}
          />
        </Stack>
      ))}
    </Stack>
  );
}
