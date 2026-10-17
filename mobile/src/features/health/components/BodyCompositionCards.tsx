import { formatDateDisplay } from '@trainingai/shared/date-utils';
import { bodyComposition } from '@trainingai/shared/health/body-composition';
import { AppText, Card, Disclosure, Grid, LineChart, MetricTile, Stack } from '../../../shared/ui';
import { useTheme } from '../../../shared/theme/ThemeProvider';
import { displayFat, latestMetric, type BodyRow } from '../data/models';
import { useCueColor } from './RangeBar';

const round1 = (x: number) => parseFloat(x.toFixed(1));

/**
 * Body Composition from weight and body fat: lean mass with its change since the oldest reading,
 * fat mass, the Cunningham BMR and a lean-mass trend. Needs two days with both readings.
 */
export function LeanMassCard({ rows }: { rows: readonly BodyRow[] }) {
  const { theme } = useTheme();
  const cueColor = useCueColor();
  // Oldest first, weight and (corrected) body fat on the same day.
  const valid = [...rows]
    .reverse()
    .filter((row) => row.weightKg !== null && displayFat(row) !== null);
  if (valid.length < 2) return null;
  const comp = (row: BodyRow) => bodyComposition(row.weightKg, displayFat(row));
  const latest = comp(valid[valid.length - 1]);
  const oldest = comp(valid[0]);
  if (!latest) return null;
  const lean = round1(latest.ffmKg);
  const delta = oldest ? round1(lean - round1(oldest.ffmKg)) : null;
  const series = valid.flatMap((row, index) => {
    const c = comp(row);
    return c ? [{ label: row.date, value: round1(c.ffmKg), x: index }] : [];
  });
  return (
    <Card>
      <AppText variant="eyebrow" tone="muted">
        Body Composition
      </AppText>
      <AppText variant="title" style={{ color: theme.anatomy.main }}>
        {lean} kg{' '}
        <AppText variant="body" tone="muted">
          lean
        </AppText>
      </AppText>
      {delta !== null && (
        <AppText variant="caption" style={{ color: cueColor(delta >= 0 ? 'good' : 'bad') }}>
          {delta >= 0 ? '+' : ''}
          {delta} kg from oldest
        </AppText>
      )}
      <Grid columns={2}>
        <MetricTile label="Fat Mass" value={`${round1(latest.fatMassKg)} kg`} />
        <MetricTile
          label="BMR"
          value={`${Math.round(latest.bmrKcal)} kcal`}
          caption="calculated from lean mass"
        />
      </Grid>
      {series.length >= 2 && (
        <LineChart
          points={series}
          label="Lean mass trend"
          readable
          color={theme.anatomy.main}
          axisLabels={[
            formatDateDisplay(series[0].label, 'short'),
            formatDateDisplay(series[series.length - 1].label, 'short'),
          ]}
        />
      )}
      <Disclosure title="About this card">
        <AppText variant="caption" tone="muted">
          Fat-free mass = weight × (1 − body fat %); fat mass = weight × body fat %; BMR uses the
          Cunningham equation (fat-free mass × 21.6 + 370 kcal/day). The chart tracks lean mass.
          Requires both weight and body fat % readings on the same day.
        </AppText>
      </Disclosure>
    </Card>
  );
}

const fmt = (value: number | null, unit: string) => (value === null ? null : `${value}${unit}`);

/** Body Composition (Scale): every tile from the last weigh-in and the skeletal-muscle trend. */
export function ScaleCompositionCard({ rows }: { rows: readonly BodyRow[] }) {
  const { theme } = useTheme();
  const latest = latestMetric([...rows], 'skeletalMusclePct');
  if (!latest) return null;
  const series = [...rows]
    .reverse()
    .flatMap((row, index) =>
      row.skeletalMusclePct === null
        ? []
        : [{ label: row.date, value: row.skeletalMusclePct, x: index }],
    );
  const tiles: { label: string; value: string | null; note?: string }[] = [
    { label: 'Skeletal Muscle', value: fmt(latest.skeletalMusclePct, '%') },
    { label: 'Fat-Free Mass', value: fmt(latest.fatFreeMassKg, ' kg') },
    { label: 'Muscle Mass', value: fmt(latest.muscleMassKg, ' kg') },
    { label: 'Bone Mass', value: fmt(latest.boneMassKg, ' kg') },
    { label: 'Body Water', value: fmt(latest.bodyWaterPct, '%') },
    { label: 'Subcutaneous Fat', value: fmt(latest.subcutaneousFatPct, '%') },
    { label: 'Visceral Fat', value: fmt(latest.visceralFatIndex, ''), note: 'from BMI & age' },
    { label: 'Protein', value: fmt(latest.proteinPct, '%') },
    { label: 'BMR', value: fmt(latest.bmrKcal, ' kcal'), note: 'from weight & height' },
    { label: 'Metabolic Age', value: fmt(latest.metabolicAge, ' yrs') },
  ].filter((tile) => tile.value !== null);
  return (
    <Card>
      <Stack gap="xxs">
        <AppText variant="eyebrow" tone="muted">
          Body Composition (Scale)
        </AppText>
        <AppText variant="caption" tone="muted">
          From your last weigh-in
        </AppText>
      </Stack>
      {series.length >= 2 && (
        <Stack gap="xxs">
          <LineChart
            points={series}
            label="Skeletal muscle percent trend"
            readable
            fill
            tone="nutrition"
            color={theme.tones.nutrition.foreground}
            axisLabels={[
              formatDateDisplay(series[0].label, 'short'),
              formatDateDisplay(series[series.length - 1].label, 'short'),
            ]}
          />
          <AppText variant="caption" tone="muted">
            Skeletal muscle % trend
          </AppText>
        </Stack>
      )}
      <Grid columns={2}>
        {tiles.map((tile) => (
          <MetricTile key={tile.label} label={tile.label} value={tile.value} caption={tile.note} />
        ))}
      </Grid>
      <Disclosure title="About this card">
        <AppText variant="caption" tone="muted">
          Measured directly by your body-composition scale (bioelectrical impedance), so it only
          updates from an actual weigh-in with bare-foot skin contact, not calculated from weight
          and body fat like the Body Composition card above. Two exceptions, marked on their tiles:
          BMR is the Mifflin-St Jeor equation and Visceral Fat is derived from BMI and age, so
          neither uses impedance. Your calorie targets prefer a clinically measured resting rate
          when you have one, which is why the two figures can differ.
        </AppText>
      </Disclosure>
    </Card>
  );
}
