import { useState } from 'react';
import { randomUUID } from 'expo-crypto';
import { Linking, View } from 'react-native';
import {
  AppButton,
  AppText,
  Card,
  ChipPicker,
  IconButton,
  ListRow,
  Sheet,
  Stack,
  SwitchRow,
  TextField,
} from '../../../shared/ui';
import { useTheme } from '../../../shared/theme/ThemeProvider';
import { usePlatformIntegrations } from '../PlatformProvider';
import { calendars } from '../../../integrations/calendar/platform';
import { reminderKinds, reminderLabels, reminderSchema, type Reminder } from '../data/models';

const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export function IntegrationSettings() {
  const {
    state,
    store,
    calendar,
    calendarState,
    enableAlerts,
    permission,
    alertError,
    refresh,
  } = usePlatformIntegrations();
  const { theme } = useTheme();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  const [choices, setChoices] = useState<Awaited<ReturnType<typeof calendars>>>([]);
  const [editing, setEditing] = useState<Reminder | null>(null);
  const [showChoices, setShowChoices] = useState(false);
  async function run(action: () => Promise<unknown>) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await action();
      refresh();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Could not update integration settings.',
      );
    } finally {
      setBusy(false);
    }
  }
  const settings = state?.settings;
  return (
    <Card>
      <AppText variant="heading">Alerts & calendar</AppText>
      {!store || !state?.ready ? (
        <AppText tone="muted">Sign in to configure your alerts and calendar.</AppText>
      ) : (
        <>
          <SwitchRow
            label="Keep screen awake during training"
            value={settings!.keepAwake}
            disabled={busy}
            onValueChange={(keepAwake) => void run(() => store.configure({ keepAwake }))}
          />
          <SwitchRow
            label="Rest complete alerts"
            value={settings!.restAlerts}
            disabled={busy}
            onValueChange={(value) =>
              void run(() =>
                value ? enableAlerts('restAlerts') : store.configure({ restAlerts: false }),
              )
            }
          />
          <SwitchRow
            label="Guided activity cues"
            value={settings!.walkCues}
            disabled={busy}
            onValueChange={(value) =>
              void run(() =>
                value ? enableAlerts('walkCues') : store.configure({ walkCues: false }),
              )
            }
          />
          {!permission &&
            (settings!.restAlerts ||
              settings!.walkCues ||
              settings!.reminders.some((row) => row.enabled)) && (
              <AppButton
                title="Enable notification permission"
                variant="secondary"
                busy={busy}
                onPress={() => void run(() => enableAlerts())}
              />
            )}
          <AppText variant="label">Reminders</AppText>
          {settings!.reminders.map((row) => (
            <Stack key={row.id} direction="row" align="center">
              <View style={{ flex: 1 }}>
                <ListRow
                  title={row.title}
                  subtitle={`${row.time} · ${row.days.length === 7 ? 'Every day' : row.days.map((day) => dayNames[day]).join(', ')}${row.enabled ? '' : ' · Off'}`}
                  density="compact"
                  onPress={() => setEditing(row)}
                />
              </View>
              <IconButton
                icon="delete"
                label={`Delete ${row.title} reminder`}
                onPress={() => void run(() => store.removeReminder(row.id))}
              />
            </Stack>
          ))}
          <AppButton
            title="Add reminder"
            icon="plus"
            variant="secondary"
            disabled={settings!.reminders.length >= 12}
            onPress={() =>
              setEditing({
                id: randomUUID(),
                kind: 'workout',
                title: 'Workout',
                time: '17:00',
                days: [1, 3, 5],
                enabled: true,
              })
            }
          />
          <AppText variant="caption" tone="muted">
            Times follow your phone’s local clock. Notifications follow your phone’s sound and
            Focus settings.
          </AppText>
          <AppText variant="label">Workout calendar</AppText>
          <AppButton
            title={settings!.calendarId ? 'Change calendar' : 'Choose a calendar'}
            icon="calendar"
            variant="secondary"
            busy={busy}
            onPress={() =>
              void run(async () => {
                setChoices(await calendars(true));
                setShowChoices(true);
              })
            }
          />
          {settings!.calendarId && (
            <AppText variant="caption" tone="muted">
              {choices.find((row) => row.id === settings!.calendarId)?.title ??
                settings!.calendarTitle ??
                'Calendar selected'}
            </AppText>
          )}
          <SwitchRow
            label="Add completed workouts automatically"
            value={settings!.calendarAuto}
            disabled={busy || !settings!.calendarId}
            onValueChange={(calendarAuto) =>
              void run(async () => {
                if (calendarAuto) {
                  const available = await calendars(true);
                  if (!available.some((row) => row.id === settings!.calendarId))
                    throw new Error(
                      'That calendar is no longer writable. Choose another calendar.',
                    );
                }
                await store.configure({
                  calendarAuto,
                  ...(calendarAuto ? { calendarSince: Date.now() } : {}),
                });
              })
            }
          />
          <AppText variant="caption" tone="muted">
            Applies to new completed workouts. Previous workouts saved on this phone can be
            added from their completion screen.
          </AppText>
          {showChoices && (
            <Sheet visible title="Choose calendar" onClose={() => setShowChoices(false)}>
              {choices.length ? (
                choices.map((row) => (
                  <ListRow
                    key={row.id}
                    title={row.title}
                    subtitle={row.source}
                    onPress={() =>
                      void run(async () => {
                        await store.configure({ calendarId: row.id, calendarTitle: row.title });
                        setShowChoices(false);
                      })
                    }
                  />
                ))
              ) : (
                <AppText>
                  No writable calendars were found. Add a calendar account in your phone
                  settings.
                </AppText>
              )}
            </Sheet>
          )}
          {editing && (
            <ReminderEditor
              reminder={editing}
              onClose={() => setEditing(null)}
              onSave={async (reminder) => {
                if (reminder.enabled) await enableAlerts();
                await store.saveReminder(reminder);
                setEditing(null);
                refresh();
              }}
            />
          )}
        </>
      )}
      <View style={{ minHeight: theme.sizes.touchTarget }}>
        <AppText variant="caption" tone="muted" accessibilityLiveRegion="polite">
          {error ??
            state?.error ??
            alertError ??
            calendarState?.error ??
            'Integration settings are saved on this phone.'}
        </AppText>
      </View>
      {(error || state?.error || alertError || calendarState?.error) && (
        <Stack direction="row">
          <AppButton
            title="Retry"
            variant="ghost"
            busy={busy}
            onPress={() =>
              void run(async () => {
                await store?.retry();
                await calendar?.retry();
                refresh();
              })
            }
          />
          <AppButton
            title="Phone settings"
            variant="ghost"
            onPress={() => void Linking.openSettings()}
          />
        </Stack>
      )}
    </Card>
  );
}
export function ReminderEditor({
  reminder,
  onClose,
  onSave,
  embedded = false,
}: {
  reminder: Reminder;
  onClose: () => void;
  onSave: (value: Reminder) => Promise<void>;
  embedded?: boolean;
}) {
  const [value, setValue] = useState(reminder),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  const form = (
    <Stack gap="md">
      <ChipPicker
        label="Type"
        value={value.kind}
        options={reminderKinds.map((kind) => ({ value: kind, label: reminderLabels[kind] }))}
        onChange={(kind) => {
          if (kind)
            setValue((row) => ({
              ...row,
              kind,
              title: row.title === reminderLabels[row.kind] ? reminderLabels[kind] : row.title,
              ...(kind === 'week' ? { days: [0] } : {}),
            }));
        }}
      />
      <TextField
        label="Title"
        value={value.title}
        onChangeText={(title) => setValue((row) => ({ ...row, title }))}
        maxLength={100}
      />
      <TextField
        label="Time (24-hour)"
        value={value.time}
        placeholder="17:00"
        maxLength={5}
        onChangeText={(time) => setValue((row) => ({ ...row, time }))}
        keyboardType="numbers-and-punctuation"
      />
      <AppText variant="label">Repeat on</AppText>
      <Stack direction="row" gap="xxs">
        {dayNames.map((name, day) => (
          <AppButton
            key={day}
            title={name.slice(0, 2)}
            style={{ flex: 1 }}
            variant={value.days.includes(day) ? 'primary' : 'surface'}
            accessibilityLabel={`${name}, ${value.days.includes(day) ? 'selected' : 'not selected'}`}
            onPress={() =>
              setValue((row) => ({
                ...row,
                days: row.days.includes(day)
                  ? row.days.filter((item) => item !== day)
                  : [...row.days, day].sort(),
              }))
            }
          />
        ))}
      </Stack>
      <SwitchRow
        label="Enabled"
        value={value.enabled}
        onValueChange={(enabled) => setValue((row) => ({ ...row, enabled }))}
      />
      {error && (
        <AppText tone="muted" accessibilityRole="alert">
          {error}
        </AppText>
      )}
      <AppButton
        title="Save reminder"
        busy={busy}
        onPress={() => {
          const parsed = reminderSchema.safeParse(value);
          if (!parsed.success) {
            setError('Enter a title, a valid HH:MM time and at least one repeat day.');
            return;
          }
          setBusy(true);
          setError(null);
          void onSave(parsed.data)
            .catch((cause) =>
              setError(cause instanceof Error ? cause.message : 'Could not save reminder.'),
            )
            .finally(() => setBusy(false));
        }}
      />
    </Stack>
  );
  return embedded ? (
    form
  ) : (
    <Sheet visible title="Reminder" onClose={onClose}>
      {form}
    </Sheet>
  );
}
