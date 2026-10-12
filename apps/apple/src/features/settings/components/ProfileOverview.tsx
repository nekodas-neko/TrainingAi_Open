import { AppText, Card, Disclosure, KeyValueGrid } from '../../../shared/ui';
import { useHealthData } from '../../health/data/HealthDataProvider';
import { useAppleImport } from '../../health/HealthProvider';
import { formatHoursMinutes } from '@trainingai/shared/format/units';
import { metricValue } from '../../health/data/models';
export function ProfileOverview() {
  const health = useHealthData(),
    apple = useAppleImport();
  const latest = health.body?.recent[0];
  const night = health.sleep[0];
  return (
    <Card>
      <Disclosure title="Measured overview">
        <KeyValueGrid
          rows={[
            { label: 'Body weight', value: metricValue(health.body?.latestWeightKg, 'kg', 1) },
            {
              label: 'Body fat',
              value: metricValue(latest?.bodyFatCorrected ?? latest?.bodyFat, '%', 1),
            },
            {
              label: 'Resting heart rate',
              value: metricValue(latest?.restingHeartRate, 'bpm'),
            },
            { label: 'HRV', value: metricValue(latest?.hrvMs, 'ms', 1) },
            { label: 'HRV · SDNN', value: metricValue(apple.completed?.hrv?.value, 'ms', 1) },
            {
              label: 'Last sleep',
              value:
                night?.durationHours != null
                  ? formatHoursMinutes(night.durationHours * 60)
                  : '—',
            },
            { label: 'Waist', value: metricValue(latest?.waistCm, 'cm', 1) },
            { label: 'Steps', value: metricValue(latest?.steps) },
          ]}
        />
        <AppText variant="caption" tone="muted">
          Latest saved readings. Unavailable measurements stay blank; HRV methods are shown
          separately.
        </AppText>
      </Disclosure>
    </Card>
  );
}
