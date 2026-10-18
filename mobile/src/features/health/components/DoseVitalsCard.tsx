import { useState } from 'react';
import { AppText, Card, LineChart, SegmentedControl } from '../../../shared/ui';
import { useTheme } from '../../../shared/theme/ThemeProvider';
import { useWorkoutResource } from '../../workouts/data/WorkoutDataProvider';
import { doseVitalsSpec } from '../data/models';
import {
  buildDoseVitalsSeries,
  doseLabel,
  latestDoses,
  METRIC_LABEL,
  type DoseMetric,
} from '@trainingai/shared/health/dose-vitals-series';
import { HealthResourceHeader } from './HealthResourceHeader';
export function DoseVitalsCard() {
  const state = useWorkoutResource(doseVitalsSpec);
  const { theme } = useTheme();
  const [metric, setMetric] = useState<DoseMetric>('rhr');
  if (!state.data?.doses.length && !state.error) {
    return null;
  }
  const data = state.data;
  const points = data
    ? buildDoseVitalsSeries(data.nights, data.doses, metric, data.effectLookbackDays)
    : [];
  return (
    <Card>
      <HealthResourceHeader
        title="Doses against vitals"
        state={state}
        refresh={state.refresh}
      />
      <SegmentedControl
        label="Dose overlay metric"
        options={[
          { value: 'rhr', label: 'Resting HR' },
          { value: 'hrv', label: 'HRV' },
        ]}
        value={metric}
        onChange={setMetric}
      />
      <LineChart
        label={METRIC_LABEL[metric]}
        interactive
        tone={metric === 'rhr' ? 'heart' : 'sleep'}
        points={points.map((p, i) => ({ x: i, label: p.date, value: p.value }))}
        series={[
          {
            label: 'Baseline',
            color: theme.colors.muted,
            dashed: true,
            points: points.map((p, i) => ({ x: i, value: p.baseline })),
          },
        ]}
        markers={points.flatMap((p, i) =>
          p.dosedOn
            ? [{ x: i, label: 'Dose taken', color: theme.tones.nutrition.foreground }]
            : [],
        )}
      />
      <AppText variant="micro" tone="muted">
        Dose markers show when it was taken. Read the days after a marker; the measured effect
        peaked 2–4 days later. The dashed line is that night’s stored baseline.
      </AppText>
      {latestDoses(data?.doses ?? []).map((dose, i) => (
        <AppText key={dose.date + i} variant="micro" tone="muted">
          {dose.date} · {doseLabel(dose)}
        </AppText>
      ))}
    </Card>
  );
}
