import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { formatDateDisplay } from '@trainingai/shared/date-utils';
import { bodyComposition } from '@trainingai/shared/health/body-composition';
import {
  AppText,
  Card,
  Disclosure,
  DisclosureIcon,
  Grid,
  LineChart,
  MetricTile,
  Stack,
} from '../../../shared/ui';
import { layoutMotion } from '../../../shared/ui/layoutMotion';
import { PRESSED_OPACITY } from '../../../shared/ui/pressFeedback';
import { useReducedMotion } from '../../../shared/ui/useReducedMotion';
import { bodyCardColors } from '../../../shared/theme/tokens';
import { useTheme } from '../../../shared/theme/ThemeProvider';
import { displayFat, latestMetric, type BodyRow } from '../data/models';
import { useCueColor } from './RangeBar';
import { scaleEstimates, weighInDay } from '../data/scale-composition';

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
    <Card accent={bodyCardColors.leanMass}>
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
          gaps="connect"
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

/**
 * Body Composition (Scale), option A of #3770: weight and body fat from the last weigh-in, a body
 * fat trend, and the figures estimated from weight, height, age and sex in a closed section.
 */
export function ScaleCompositionCard({ rows, today }: { rows: readonly BodyRow[]; today: string }) {
  const { theme } = useTheme();
  const reduced = useReducedMotion();
  const [open, setOpen] = useState(false);
  // A scale weigh-in is the row that carries the scale's own figures.
  const latest = latestMetric([...rows], 'skeletalMusclePct');
  if (!latest) return null;
  const fat = displayFat(latest);
  const series = [...rows].reverse().flatMap((row, index) => {
    const value = displayFat(row);
    return value == null ? [] : [{ label: row.date, value, x: index }];
  });
  const estimates = scaleEstimates(latest);
  return (
    <Card accent={bodyCardColors.composition}>
      <Stack gap="xxs">
        <AppText variant="eyebrow" tone="muted">
          Body Composition (Scale)
        </AppText>
        <AppText variant="caption" tone="muted">
          From your weigh-in {weighInDay(latest.date, today)}
        </AppText>
      </Stack>
      <Grid columns={2}>
        <MetricTile
          compact
          label="Weight"
          value={latest.weightKg == null ? null : `${round1(latest.weightKg)} kg`}
          caption="measured"
        />
        <MetricTile
          compact
          label="Body Fat"
          value={fat == null ? null : `${round1(fat)}%`}
          caption="measured, with a formula"
        />
      </Grid>
      {series.length >= 2 && (
        <Stack gap="xxs">
          <LineChart
            points={series}
            label="Body fat percent trend"
            readable
            fill
            gaps="connect"
            tone="nutrition"
            color={theme.tones.nutrition.foreground}
            axisLabels={[
              formatDateDisplay(series[0].label, 'short'),
              formatDateDisplay(series[series.length - 1].label, 'short'),
            ]}
          />
          <AppText variant="caption" tone="muted">
            Body fat % trend
          </AppText>
        </Stack>
      )}
      {estimates.length > 0 && (
        <View
          style={{
            borderTopWidth: StyleSheet.hairlineWidth,
            borderTopColor: theme.colors.border,
            paddingTop: theme.spacing.xs,
            gap: theme.spacing.xs,
          }}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded: open }}
            accessibilityLabel={`Estimated from weight, height, age and sex, ${estimates.length} figures`}
            onPress={() => {
              layoutMotion(reduced);
              setOpen(!open);
            }}
            style={({ pressed }) => ({
              minHeight: theme.sizes.touchTarget,
              justifyContent: 'center',
              opacity: pressed ? PRESSED_OPACITY : 1,
            })}
          >
            <Stack direction="row" align="center" gap="xs">
              <Stack gap="xxs" style={{ flex: 1, minWidth: 0 }}>
                <AppText variant="label">
                  Estimated from weight, height, age and sex · {estimates.length}
                </AppText>
                <AppText variant="caption" tone="muted">
                  Muscle, water, bone, protein, visceral fat, BMR, metabolic age and the rest. They
                  move only when your weight moves.
                </AppText>
              </Stack>
              <DisclosureIcon expanded={open} collapsed="right" />
            </Stack>
          </Pressable>
          {open && (
            <Grid columns={2}>
              {estimates.map((tile) => (
                <MetricTile
                  key={tile.label}
                  compact
                  label={tile.label}
                  value={tile.value}
                  color={theme.colors.muted}
                />
              ))}
            </Grid>
          )}
        </View>
      )}
      <Disclosure title="About this card">
        <AppText variant="caption" tone="muted">
          Your scale measures two things: your weight and an impedance reading. Weight is measured
          directly. Body fat % comes from a formula on your height, weight, age and sex, adjusted a
          little by the impedance reading. The figures under “Estimated” are fixed ratios of weight,
          height, age and sex, so they move only when your weight does: BMR is the Mifflin-St Jeor
          equation and Visceral Fat comes from BMI and age. Your calorie targets prefer a clinically
          measured resting rate when you have one, which is why the two figures can differ.
        </AppText>
      </Disclosure>
    </Card>
  );
}
