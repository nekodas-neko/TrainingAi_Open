import { AppText } from './AppText';
import { Grid } from './Grid';
import { Stack } from './Stack';
export function KeyValueGrid({ rows }: { rows: readonly { label: string; value: string }[] }) {
  return (
    <Grid columns={2}>
      {rows.map((row) => (
        <Stack key={row.label} direction="row" justify="space-between" align="baseline">
          <AppText variant="micro" tone="muted" style={{ flex: 1 }}>
            {row.label}
          </AppText>
          <AppText variant="caption">{row.value}</AppText>
        </Stack>
      ))}
    </Grid>
  );
}
