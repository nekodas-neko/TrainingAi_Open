import { Grid, MetricTile } from '../../../shared/ui';
import type { Tone } from '../../../shared/theme/theme';
import { useHealthContext } from '../HealthProvider';

const metricTones: Record<string, Tone> = {
  sleep: 'sleep',
  hr: 'heart',
  rhr: 'heart',
  steps: 'activity',
  energy: 'brand',
};
export function HealthSummary() {
  const { snapshot } = useHealthContext();
  const metrics = snapshot?.metrics ?? [
    { key: 'sleep', label: 'Sleep', value: null },
    { key: 'rhr', label: 'Resting heart rate', value: null },
    { key: 'steps', label: 'Steps', value: null },
    { key: 'energy', label: 'Active energy', value: null },
  ];
  return (
    <Grid>
      {metrics.map((metric) => (
        <MetricTile
          key={metric.key}
          label={metric.label}
          value={metric.value}
          tone={metricTones[metric.key] ?? 'brand'}
          caption={
            snapshot
              ? metric.value === null
                ? 'Unavailable'
                : snapshot.mode === 'sample'
                  ? 'Sample data'
                  : (snapshot.metrics.find((reading) => reading.key === metric.key)?.source ??
                    'Apple Health')
              : 'No reading loaded'
          }
        />
      ))}
    </Grid>
  );
}
