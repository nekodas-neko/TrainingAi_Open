import { useState } from 'react';
import { msToHHMMInTz } from '@trainingai/shared/date-utils';
import {
  AppButton,
  AppText,
  Badge,
  Card,
  ConfirmationCard,
  Notice,
  Stack,
  TextField,
} from '../../../shared/ui';
import { useHealthData } from '../data/HealthDataProvider';
import { manualNightWindow } from '../data/manual-night';
import { metricValue } from '../data/models';
import { failureNotice } from '../../../core/reporting/index.ts';

export function ManualNightCard() {
  const health = useHealthData();
  const night = health.sleep.find((row) => row.date === health.today);
  const [editing, setEditing] = useState(false);
  const [bed, setBed] = useState('');
  const [wake, setWake] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [remove, setRemove] = useState(false);
  if (
    !health.ready ||
    (!health.sleepAt && !health.operations.some((op) => op.domain === 'manual_sleep')) ||
    (night && !night.manualEntry)
  ) {
    return null;
  }
  async function save() {
    if (!health.store || busy) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const window = manualNightWindow(health.today, bed, wake, health.timezone);
      if (!window) {
        throw new Error('Enter times like 23:10 and 06:40.');
      }
      await health.store.saveNight(
        window.sleepStart,
        window.sleepEnd,
        health.timezone,
        night?.id,
      );
      setEditing(false);
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Could not save that night.');
    } finally {
      setBusy(false);
    }
  }
  async function deleteNight() {
    if (!night?.id || !health.store || busy) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await health.store.removeNight(night.id, night.date);
      setRemove(false);
      setEditing(false);
    } catch (failure) {
      setError(failureNotice('Could not remove that night. Try again.', failure));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card tone="sleep">
      <Stack direction="row">
        <AppText variant="eyebrow" tone="muted">
          Last night
        </AppText>
        {night && <Badge label="Logged by hand" tone="sleep" />}
      </Stack>
      {!night || editing ? (
        <>
          <AppText variant="caption" tone="muted">
            Enter your bed time and wake time. Only the sleep window is recorded.
          </AppText>
          <TextField
            label="Went to bed (HH:MM)"
            value={bed}
            onChangeText={setBed}
            placeholder="23:10"
            keyboardType="numbers-and-punctuation"
          />
          <TextField
            label="Woke up (HH:MM)"
            value={wake}
            onChangeText={setWake}
            placeholder="06:40"
            keyboardType="numbers-and-punctuation"
          />
          <AppButton
            title="Save night"
            busy={busy}
            disabled={!health.store}
            onPress={() => {
              void save();
            }}
          />
          {editing && (
            <AppButton title="Cancel" variant="ghost" onPress={() => setEditing(false)} />
          )}
        </>
      ) : (
        <>
          <AppText variant="heading">
            {night.sleepStart && msToHHMMInTz(night.sleepStart, health.timezone)} →{' '}
            {night.sleepEnd && msToHHMMInTz(night.sleepEnd, health.timezone)}
          </AppText>
          <AppText variant="caption" tone="muted">
            {metricValue(night.durationHours, 'h', 2)}
          </AppText>
          <Stack direction="row">
            <AppButton
              title="Edit"
              variant="surface"
              onPress={() => {
                setBed(night.sleepStart ? msToHHMMInTz(night.sleepStart, health.timezone) : '');
                setWake(night.sleepEnd ? msToHHMMInTz(night.sleepEnd, health.timezone) : '');
                setEditing(true);
              }}
            />
            <AppButton title="Remove night" variant="ghost" onPress={() => setRemove(true)} />
          </Stack>
        </>
      )}
      {remove && (
        <ConfirmationCard
          title="Remove this night?"
          message="Only the manually entered night will be removed."
          confirmLabel="Remove"
          cancelLabel="Cancel"
          danger
          busy={busy}
          onConfirm={() => {
            void deleteNight();
          }}
          onCancel={() => setRemove(false)}
        />
      )}
      {error && <Notice title="Sleep entry" message={error} error />}
    </Card>
  );
}
