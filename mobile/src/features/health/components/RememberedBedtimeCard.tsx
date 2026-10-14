import { useState } from 'react';
import { formatTimeOfDay, msToHHMMInTz } from '@trainingai/shared/date-utils';
import { AppButton, AppText, Card, Notice, Stack, TextField } from '../../../shared/ui';
import { useHealthData } from '../data/HealthDataProvider';
import { bedtimeInstant } from '../data/manual-night';
import type { SleepRow } from '../data/models';
export function RememberedBedtimeCard({ night }: { night: SleepRow }) {
  const health = useHealthData();
  const [editing, setEditing] = useState(false);
  const [clock, setClock] = useState(
    night.manualSleepStart ? msToHHMMInTz(night.manualSleepStart, health.timezone) : '',
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function save(clear = false) {
    if (!health.store || busy) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const at = clear ? null : bedtimeInstant(night.date, clock, health.timezone);
      if (!clear && !at) {
        throw new Error('Enter a time like 23:15.');
      }
      await health.store.rememberBedtime(night.date, at);
      setEditing(false);
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Could not save that bedtime.');
    } finally {
      setBusy(false);
    }
  }
  if (night.localOnly) {
    return null;
  }
  return (
    <Card>
      <AppText variant="eyebrow" tone="muted">
        When did you go to bed?
      </AppText>
      {night.sleepStart && (
        <AppText variant="caption" tone="muted">
          Recorded sleep started at {formatTimeOfDay(night.sleepStart, health.timezone)}.
        </AppText>
      )}
      {!night.manualSleepStart || editing ? (
        <>
          <TextField
            label="Bedtime (HH:MM)"
            value={clock}
            onChangeText={setClock}
            placeholder="23:15"
            keyboardType="numbers-and-punctuation"
          />
          <AppButton
            title="Save bedtime"
            busy={busy}
            onPress={() => {
              void save();
            }}
          />
        </>
      ) : (
        <>
          <AppText>{formatTimeOfDay(night.manualSleepStart, health.timezone)}</AppText>
          <Stack direction="row">
            <AppButton title="Edit" variant="surface" onPress={() => setEditing(true)} />
            <AppButton
              title="Clear"
              variant="ghost"
              busy={busy}
              onPress={() => {
                void save(true);
              }}
            />
          </Stack>
        </>
      )}
      <AppText variant="caption" tone="muted">
        This records the time you remember. It doesn’t change the measured sleep window or
        duration.
      </AppText>
      {error && <Notice title="Bedtime" message={error} error />}
    </Card>
  );
}
