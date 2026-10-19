import { useRecordedIntake } from '../data/useRecordedIntake';
import { balanceZone, barProgress } from '@trainingai/shared/nutrition/calorie-balance';
import { useState } from 'react';
import { useTheme } from '../../../shared/theme/ThemeProvider';
import {
  AppButton,
  AppText,
  Card,
  GradientProgressBar,
  Grid,
  IconButton,
  MetricTile,
  ProgressBar,
  SegmentRing,
  Stack,
  StatusIndicator,
} from '../../../shared/ui';
import { energySpec } from '../../health/data/models';
import { useWorkoutResource } from '../../workouts/data/WorkoutDataProvider';
import { balanceProvenance, budgetLine } from '../data/budget-line';
import { useNutrition } from '../data/NutritionProvider';
import { macroShares } from '@trainingai/shared/nutrition/macro-energy';
export function NutritionEnergyCard({ date, onGoals }: { date: string; onGoals: () => void }) {
  const n = useNutrition(date);
  const [info, setInfo] = useState(false);
  const { theme } = useTheme();
  const state = useWorkoutResource(energySpec(date));
  const data = state.data?.date === date ? state.data : null;
  const b = data?.balance;
  const resolved = useRecordedIntake(date, b);
  const total =
    n.view.totals && resolved.intake != null
      ? { ...n.view.totals, calories: resolved.intake }
      : n.view.totals;
  const goal = b?.budgetKcal ?? n.view.targets.calories ?? null;
  const pending = n.operations.some((op) => op.date === date && op.domain === 'food_logs');
  const remaining = total && goal != null ? goal - total.calories : null;
  const shares = total ? macroShares(total) : { protein: 0, carbs: 0, fat: 0 };
  const colors = [theme.macros.protein, theme.macros.carbs, theme.macros.fat];
  const fraction = total && goal && goal > 0 ? Math.min(1, total.calories / goal) : 0;
  const scaled = data?.macroTargets;
  const targets = scaled?.scaled ?? n.view.targets;
  const provenance = balanceProvenance(b);
  // The band's own colour, always with its label beside it (colour is never the only signal).
  const zone =
    total && goal != null
      ? balanceZone(Math.round(total.calories) - Math.round(goal))
      : { label: b?.zoneLabel ?? 'Calorie balance', color: typeof b?.zoneColor === 'string' ? b.zoneColor : theme.colors.muted };
  return (
    <Card>
      <Stack direction="row" align="center" gap="lg">
        <SegmentRing
          value={fraction}
          label="Calories and macro energy"
          segments={
            Object.values(shares).some((v) => v > 0)
              ? Object.values(shares).map((share, i) => ({ share, color: colors[i] }))
              : [{ share: 1, color: theme.colors.brand }]
          }
        >
          <AppText variant="metric">
            {total ? Math.round(total.calories).toLocaleString() : '—'}
          </AppText>
          <AppText variant="micro" tone="muted">
            {goal != null ? `of ${Math.round(goal).toLocaleString()}` : 'kcal'}
          </AppText>
        </SegmentRing>
        <Stack gap="md" style={{ flex: 1, minWidth: 0 }}>
          <Stack direction="row" align="center" gap="xs">
            {remaining == null ? (
              <AppText variant="caption" tone="muted" style={{ flex: 1 }}>
                Set a calorie goal to see what’s left
              </AppText>
            ) : (
              <>
                <AppText variant="remainingValue" style={{ fontVariant: ['tabular-nums'] }}>
                  {Math.round(Math.abs(remaining)).toLocaleString()}
                </AppText>
                <AppText variant="caption" tone="muted" style={{ flex: 1 }}>
                  kcal {remaining < 0 ? 'over' : 'left'}
                </AppText>
              </>
            )}
            <StatusIndicator
              label="Calorie budget"
              busy={state.loading || state.refreshing}
              error={state.error}
              message={pending ? 'Budget is saved from before this upload.' : null}
              onRetry={state.refresh}
            />
          </Stack>
          {/* Plain columns, as the current app draws them (energy-card.tsx MacroColumn): the share
              in the macro's colour, grams over target, then the name. */}
          <Stack direction="row" gap="xs">
            {(['proteinG', 'carbsG', 'fatG'] as const).map((key, i) => (
              <Stack key={key} gap="none" align="center" style={{ flex: 1, minWidth: 0 }}>
                <AppText variant="macroShare" style={{ color: colors[i], fontVariant: ['tabular-nums'] }}>
                  {total ? Math.round(Object.values(shares)[i] * 100) : 0}%
                </AppText>
                <AppText variant="macroValue" style={{ fontVariant: ['tabular-nums'] }}>
                  {total ? Math.round(total[key]) : '—'}
                  {targets[key] != null && (
                    <AppText variant="macroCaption" tone="muted">
                      /{Math.round(targets[key]!)}
                    </AppText>
                  )}
                  <AppText variant="macroCaption" tone="muted">
                    {' '}
                    g
                  </AppText>
                </AppText>
                <AppText variant="macroCaption" tone="muted">
                  {['Protein', 'Carbs', 'Fat'][i]}
                </AppText>
              </Stack>
            ))}
          </Stack>
        </Stack>
      </Stack>
      <AppText variant="caption" tone="muted">
        {n.view.loggingComplete
          ? 'All meals recorded or skipped.'
          : 'Recorded intake so far · unrecorded meals are excluded.'}
      </AppText>
      {b && (
        <>
          <Stack direction="row" align="center" justify="space-between">
            <AppText
              variant="caption"
              tone={pending ? 'muted' : undefined}
              style={pending ? undefined : { color: zone.color, fontWeight: '600' }}
            >
              {pending ? 'Budget awaiting upload' : zone.label}
              {date === n.today ? ' so far' : ''}
            </AppText>
            <IconButton
              icon="info"
              label="How today’s calorie budget is calculated"
              onPress={() => setInfo(!info)}
            />
          </Stack>
          <CalorieProgress intake={total?.calories ?? null} budget={goal} />
          {provenance && (
            <AppText variant="micro" tone="muted">
              {budgetLine(provenance, b)}
            </AppText>
          )}
          {info && (
            <Stack>
              <Grid columns={3}>
                <MetricTile
                  label="Eaten"
                  value={total ? Math.round(total.calories) + ' kcal' : null}
                />
                <MetricTile
                  label="Burned"
                  value={
                    b.expenditureKcal == null ? null : Math.round(b.expenditureKcal) + ' kcal'
                  }
                />
                <MetricTile
                  label="Net"
                  value={
                    total && b.expenditureKcal != null
                      ? Math.round(total.calories - b.expenditureKcal) + ' kcal'
                      : null
                  }
                />
              </Grid>
              <AppText variant="caption" tone="muted">
                Resting {b.restingBaseKcal == null ? '—' : Math.round(b.restingBaseKcal)} kcal ·
                activity {b.activeKcal == null ? '—' : Math.round(b.activeKcal)} kcal. The
                budget comes from the backend’s energy model.
              </AppText>
              {data?.maintenance && (
                <Stack>
                  <AppText variant="label">
                    {data.maintenance.source === 'calibrated'
                      ? 'Measured maintenance'
                      : 'Estimated maintenance'}{' '}
                    · {Math.round(data.maintenance.kcal)} kcal
                  </AppText>
                  <AppText variant="caption" tone="muted">
                    {data.maintenance.source === 'calibrated'
                      ? `${data.maintenance.confidence ?? 'Unknown'} confidence · ${data.maintenance.daysLogged} of ${data.maintenance.daysInWindow} days logged. It learns from your logged intake and weight trend.`
                      : (data.maintenance.gapMessage ??
                        'The profile-based estimate is used until there is enough logged history.')}
                  </AppText>
                  {data.maintenance.daysLogged >= 14 &&
                    data.maintenance.weightRateKgPerWeek != null && (
                      <AppText variant="caption" tone="muted">
                        Your recorded weight trend was{' '}
                        {Math.abs(data.maintenance.weightRateKgPerWeek) < 0.1
                          ? 'almost flat'
                          : `${data.maintenance.weightRateKgPerWeek > 0 ? '+' : ''}${data.maintenance.weightRateKgPerWeek} kg/week`}
                        . That trend is an observation; the energy figures are estimates.
                      </AppText>
                    )}
                  {data.maintenance.doseCaveat && (
                    <AppText variant="caption" tone="muted">
                      {data.maintenance.doseCaveat}
                    </AppText>
                  )}
                </Stack>
              )}
              <AppText variant="caption" tone="muted">
                Resting burn excludes habitual movement so measured workouts, activities and
                steps are added once. “On target” means within 150 kcal of the day’s budget.
              </AppText>
              <AppButton title="Nutrition goals" variant="secondary" onPress={onGoals} />
            </Stack>
          )}
        </>
      )}
      {!b && data && data.missingProfileFields.length > 0 && (
        <AppText tone="muted">
          Add {data.missingProfileFields.join(', ')} in your profile to calculate energy
          balance.
        </AppText>
      )}
    </Card>
  );
}

function CalorieProgress({ intake, budget }: { intake: number | null; budget: number | null }) {
  if (intake == null || budget == null) {
    return <ProgressBar value={0} />;
  }
  const p = barProgress({ intakeKcal: intake, budgetKcal: budget });
  return (
    <GradientProgressBar
      value={p.fillPct}
      notch={p.notchPct}
      stops={p.stops}
      label="Calories toward the daily budget"
    />
  );
}
