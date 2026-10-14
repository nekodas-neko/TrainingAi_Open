import { useState } from 'react';
import { randomUUID } from 'expo-crypto';
import { AppButton, AppText, IconButton, ListRow, Stack } from '../../../shared/ui';
import { ReminderEditor } from './IntegrationSettings';
import { usePlatformIntegrations } from '../PlatformProvider';
import { reminderLabels, type Reminder } from '../data/models';
export function NutritionReminders({ kind }: { kind: 'meal' | 'supplement' }) {
  const { store, state, enableAlerts, refresh } = usePlatformIntegrations();
  const [editing, setEditing] = useState<Reminder | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!store || !state?.ready)
    return (
      <AppText variant="caption" tone="muted">
        Sign in to configure reminders.
      </AppText>
    );
  if (editing)
    return (
      <Stack>
        <ReminderEditor
          key={editing.id}
          embedded
          reminder={editing}
          onClose={() => setEditing(null)}
          onSave={async (reminder) => {
            if (reminder.enabled) await enableAlerts();
            await store.saveReminder(reminder);
            setEditing(null);
            refresh();
          }}
        />
        <AppButton title="Back to reminders" variant="ghost" onPress={() => setEditing(null)} />
      </Stack>
    );
  return (
    <Stack>
      {state.settings.reminders
        .filter((row) => row.kind === kind)
        .map((reminder) => (
          <Stack key={reminder.id} direction="row" align="center">
            <Stack style={{ flex: 1 }}>
              <ListRow
                title={reminder.title}
                subtitle={`${reminder.time} · ${reminder.days.length === 7 ? 'Every day' : 'Selected days'}${reminder.enabled ? '' : ' · Off'}`}
                density="compact"
                onPress={() => setEditing(reminder)}
              />
            </Stack>
            <IconButton
              icon="delete"
              label={`Delete ${reminder.title} reminder`}
              onPress={() => {
                setError(null);
                void store
                  .removeReminder(reminder.id)
                  .then(refresh)
                  .catch((cause) =>
                    setError(
                      cause instanceof Error ? cause.message : 'Could not delete reminder.',
                    ),
                  );
              }}
            />
          </Stack>
        ))}
      <AppButton
        title={`Add ${kind} reminder`}
        icon="plus"
        variant="secondary"
        disabled={state.settings.reminders.length >= 12}
        onPress={() =>
          setEditing({
            id: randomUUID(),
            kind,
            title: reminderLabels[kind],
            time: kind === 'meal' ? '12:00' : '08:00',
            days: [0, 1, 2, 3, 4, 5, 6],
            enabled: true,
          })
        }
      />
      {error && (
        <AppText variant="caption" tone="muted" accessibilityRole="alert">
          {error}
        </AppText>
      )}
    </Stack>
  );
}
