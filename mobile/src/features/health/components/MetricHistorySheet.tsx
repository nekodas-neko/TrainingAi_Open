import { useState } from 'react';
import { AppText, Badge, Card, LineChart, ListRow, Sheet, Stack } from '../../../shared/ui';
import { useHealthData } from '../data/HealthDataProvider';
import { displayFat, metricValue, type BodyRow } from '../data/models';
export const metricDefinitions = {
  weightKg: { label: 'Body Weight', unit: 'kg', decimals: 1 },
  bodyFat: { label: 'Body Fat', unit: '%', decimals: 1 },
  steps: { label: 'Steps', unit: '', decimals: 0 },
  restingHeartRate: { label: 'Resting Heart Rate', unit: 'bpm', decimals: 0 },
  hrvMs: { label: 'HRV (overnight)', unit: 'ms', decimals: 0 },
  spo2Pct: { label: 'SpO₂', unit: '%', decimals: 1 },
  waterMl: { label: 'Water', unit: 'ml', decimals: 0 },
} as const;
export type MetricKind = keyof typeof metricDefinitions;
export function MetricHistorySheet({
  field,
  onClose,
}: {
  field: MetricKind;
  onClose: () => void;
}) {
  const health = useHealthData();
  const definition = metricDefinitions[field];
  const [selected, setSelected] = useState<BodyRow | null>(null);
  const rows = health.body?.recent ?? [];
  const value = (row: BodyRow) => (field === 'bodyFat' ? displayFat(row) : row[field]);
  return (
    <Sheet visible title={definition.label} onClose={onClose}>
      {health.bodyError && <AppText tone="muted">{health.bodyError}</AppText>}
      <LineChart
        label={definition.label}
        points={[...rows]
          .reverse()
          .map((row) => ({ label: row.date, value: value(row), x: Date.parse(row.date) }))}
      />
      <AppText variant="caption" tone="muted">
        Last 7 days · tap a reading for detail
      </AppText>
      {!rows.some((row) => value(row) !== null) && (
        <AppText tone="muted">No recorded readings in this period</AppText>
      )}
      {rows
        .filter((row) => value(row) !== null)
        .map((row) => (
          <ListRow
            key={row.date}
            title={row.date}
            subtitle={metricValue(value(row), definition.unit, definition.decimals)}
            onPress={() => setSelected(row)}
          />
        ))}
      {selected && (
        <Card>
          <Stack direction="row" justify="space-between">
            <AppText variant="heading">{selected.date}</AppText>
            {field === 'bodyFat' && selected.bodyFatIsCorrected && (
              <Badge label="DEXA corrected" />
            )}
          </Stack>
          <AppText variant="title">
            {metricValue(value(selected), definition.unit, definition.decimals)}
          </AppText>
          {field === 'bodyFat' && selected.bodyFatIsCorrected && (
            <AppText variant="caption" tone="muted">
              Raw reading: {metricValue(selected.bodyFat, '%', 1)}
            </AppText>
          )}
        </Card>
      )}
    </Sheet>
  );
}
