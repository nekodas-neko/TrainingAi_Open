import { useState } from 'react';
import { ZodError } from 'zod';
import { AppButton, Grid, Notice, Sheet, TextField } from '../../../shared/ui';
import { useHealthData } from '../data/HealthDataProvider';
export type LogMetric = 'weightKg' | 'bodyFat' | 'steps' | 'waterMl';
export const logLabels: Record<LogMetric, string> = {
  weightKg: 'Body Weight',
  bodyFat: 'Body Fat',
  steps: 'Steps',
  waterMl: 'Water',
};
export function MetricLogSheet({
  field,
  initial,
  onClose,
}: {
  field: LogMetric;
  initial: number | null;
  onClose: () => void;
}) {
  const health = useHealthData();
  const [value, setValue] = useState(initial === null ? '' : String(initial));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const unit =
    field === 'weightKg'
      ? 'kg'
      : field === 'bodyFat'
        ? '%'
        : field === 'waterMl'
          ? 'ml'
          : 'steps';
  async function save(preset?: number) {
    if (busy) {
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const entered = preset === undefined ? value : String(preset);
      if (!entered.trim() || !Number.isFinite(Number(entered))) {
        throw new Error('Enter a valid number.');
      }
      if (!health.store) {
        throw new Error('Sign in to save health records.');
      }
      if (field === 'waterMl') {
        await health.store.addWater(Number(entered), health.today);
      } else {
        await health.store.logMetric(field, Number(entered), health.today);
      }
      onClose();
    } catch (error) {
      setError(
        error instanceof ZodError
          ? field === 'weightKg'
            ? 'Enter a weight between 20 and 500 kg.'
            : field === 'bodyFat'
              ? 'Enter body fat between 1 and 80%.'
              : 'Enter steps between 0 and 200,000.'
          : error instanceof Error &&
              /valid number|Sign in|Check your account|Enter an amount/.test(error.message)
            ? error.message
            : 'Could not save on this phone. Try again.',
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <Sheet visible title={`Log ${logLabels[field]}`} onClose={onClose}>
      {field === 'waterMl' && (
        <Notice title="Add water" message="This amount is added to today’s total." />
      )}
      {field === 'waterMl' && (
        <Grid columns={3}>
          {[150, 250, 330, 500, 750, 1000].map((ml) => (
            <AppButton
              key={ml}
              title={`${ml} ml`}
              variant="surface"
              disabled={busy || !health.ready || !health.store}
              onPress={() => {
                void save(ml);
              }}
            />
          ))}
        </Grid>
      )}
      <TextField
        label={`${logLabels[field]} (${unit})`}
        value={value}
        onChangeText={setValue}
        keyboardType="decimal-pad"
      />
      {error && <Notice title="Could not save" message={error} error />}
      <AppButton
        title="Save"
        disabled={!health.ready || !health.store}
        busy={busy}
        onPress={() => {
          void save();
        }}
      />
    </Sheet>
  );
}
