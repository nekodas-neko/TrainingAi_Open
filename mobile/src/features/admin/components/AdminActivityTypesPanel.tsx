import { useState } from 'react';
import { View } from 'react-native';
import {
  AppButton,
  AppText,
  Card,
  IconButton,
  Notice,
  Stack,
  SwitchRow,
  TextField,
} from '../../../shared/ui';
import { useTheme } from '../../../shared/theme/ThemeProvider';
import { useWorkoutResources } from '../../workouts/data/WorkoutDataProvider';
import { activityTypesSpec } from '../../activities/data/models';
import { failureNotice } from '../../../core/reporting/index.ts';
import {
  activityDeleteConfirm,
  activityDeleteFailure,
  activityTypeBody,
  adminActivityTypesSpec,
  type AdminActivityType,
} from '../data/admin-content';
import { ConfirmSheet } from './ConfirmSheet';

type Form = { label: string; icon: string; isDistanceBased: boolean; sortOrder: string };
const blank: Form = { label: '', icon: 'DotsThreeCircle', isDistanceBased: false, sortOrder: '0' };

function ActivityTypeForm({
  initial,
  saving,
  onSave,
  onCancel,
}: {
  initial: Form;
  saving: boolean;
  onSave: (form: Form) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState(initial);
  return (
    <Card>
      <TextField
        label="Label"
        value={form.label}
        placeholder="e.g. Rowing"
        onChangeText={(label) => setForm({ ...form, label })}
      />
      <TextField
        label="Icon (Phosphor icon name, e.g. PersonSimpleRun)"
        value={form.icon}
        autoCapitalize="none"
        autoCorrect={false}
        onChangeText={(icon) => setForm({ ...form, icon })}
      />
      <SwitchRow
        label="Distance-based"
        value={form.isDistanceBased}
        onValueChange={(isDistanceBased) => setForm({ ...form, isDistanceBased })}
      />
      <TextField
        label="Sort order"
        value={form.sortOrder}
        keyboardType="number-pad"
        onChangeText={(sortOrder) => setForm({ ...form, sortOrder })}
      />
      <AppButton
        title="Save"
        busy={saving}
        disabled={!form.label.trim() || !form.icon.trim()}
        onPress={() => onSave(form)}
      />
      <AppButton title="Cancel" variant="secondary" disabled={saving} onPress={onCancel} />
    </Card>
  );
}

export function AdminActivityTypesPanel({ types }: { types: readonly AdminActivityType[] }) {
  const resources = useWorkoutResources();
  const { theme } = useTheme();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<AdminActivityType | null>(null);
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null);
  // Every logged-activity picker reads these, so a write refreshes them.
  const invalidate = [adminActivityTypesSpec.path, activityTypesSpec.path];

  async function save(form: Form, id?: string) {
    if (!resources || busy) return;
    setBusy('save');
    setNotice(null);
    try {
      const body = activityTypeBody(form);
      if (id) await resources.write('PATCH', '/api/admin/activity-types', { id, ...body }, invalidate);
      else await resources.write('POST', '/api/admin/activity-types', body, invalidate);
      setAdding(false);
      setEditing(null);
      setNotice({ text: id ? 'Activity type updated' : 'Activity type added', error: false });
    } catch (failure) {
      setNotice({ text: failureNotice('Save failed', failure), error: true });
    } finally {
      setBusy(null);
    }
  }
  async function remove(t: AdminActivityType) {
    if (!resources || busy) return;
    setBusy(`delete:${t.id}`);
    setNotice(null);
    try {
      await resources.write(
        'DELETE',
        '/api/admin/activity-types',
        undefined,
        invalidate,
        { id: t.id },
      );
      setNotice({ text: 'Activity type deleted', error: false });
    } catch (failure) {
      setNotice({ text: failureNotice(activityDeleteFailure(failure), failure), error: true });
    } finally {
      setBusy(null);
    }
  }
  return (
    <Stack>
      <AppButton
        title="Add"
        icon="plus"
        variant="surface"
        style={{ alignSelf: 'flex-end' }}
        onPress={() => {
          setAdding(true);
          setEditing(null);
        }}
      />
      {notice && <Notice title={notice.error ? 'Could not do that' : 'Done'} message={notice.text} error={notice.error} />}
      {adding && (
        <ActivityTypeForm initial={blank} saving={busy === 'save'} onSave={(f) => void save(f)} onCancel={() => setAdding(false)} />
      )}
      {types.map((t) =>
        editing === t.id ? (
          <ActivityTypeForm
            key={t.id}
            initial={{ label: t.label, icon: t.icon, isDistanceBased: t.isDistanceBased, sortOrder: String(t.sortOrder) }}
            saving={busy === 'save'}
            onSave={(f) => void save(f, t.id)}
            onCancel={() => setEditing(null)}
          />
        ) : (
          <Card key={t.id}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md }}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <AppText variant="label" numberOfLines={1}>
                  {t.label}
                </AppText>
                <AppText variant="caption" tone="muted" numberOfLines={1}>
                  {t.id} · {t.isDistanceBased ? 'distance-based' : 'non-distance'} · order {t.sortOrder}
                </AppText>
              </View>
              <IconButton
                icon="edit"
                label={`Edit ${t.label}`}
                disabled={!!busy}
                onPress={() => {
                  setEditing(t.id);
                  setAdding(false);
                }}
              />
              <IconButton
                icon="delete"
                label={`Delete ${t.label}`}
                tone="danger"
                busy={busy === `delete:${t.id}`}
                disabled={!!busy || t.id === 'other'}
                onPress={() => setPendingDelete(t)}
              />
            </View>
          </Card>
        ),
      )}
      {pendingDelete && (
        <ConfirmSheet
          {...activityDeleteConfirm(pendingDelete.label)}
          onClose={() => setPendingDelete(null)}
          onConfirm={() => void remove(pendingDelete)}
        />
      )}
    </Stack>
  );
}
