import { definitionDose, hasFreeTextBesideAmount } from '@trainingai/shared/nutrition/definition-dose';
import { supplementSubtitle } from '@trainingai/shared/nutrition/supplement-subtitle';
import { randomUUID } from 'expo-crypto';
import { useRef, useState } from 'react';
import { Switch, View } from 'react-native';
import { z } from 'zod';
import {
  AppButton,
  AppText,
  Card,
  ConfirmationCard,
  Grid,
  Icon,
  IconButton,
  ListRow,
  NumericStepper,
  Sheet,
  SortableStack,
  Stack,
  StatusIndicator,
  SwitchRow,
  TextField,
} from '../../../shared/ui';
import { useTheme } from '../../../shared/theme/ThemeProvider';
import { useWorkoutResources } from '../../workouts/data/WorkoutDataProvider';
import { useWorkoutDraft } from '../../workouts/data/useWorkoutDraft';
import { deleteSupplement } from '../data/supplement-delete';
import { useNutrition } from '../data/NutritionProvider';
import { SupplementCreateSchema, type Supplement } from '../data/models';
import { VialSheet } from './VialSheet';
import { isMilligramDosed } from '@trainingai/shared/nutrition/vial-plan';
import { NutritionReminders } from '../../platform/components/NutritionReminders';
const formSchema = z.object({
  name: z.string(),
  dose: z.string(),
  defaultAmount: z.string(),
  unit: z.string(),
  startedOn: z.string(),
  stoppedOn: z.string(),
  dosePrompt: z.boolean(),
  active: z.boolean(),
});
const blank = {
  name: '',
  dose: '',
  defaultAmount: '',
  unit: '',
  startedOn: '',
  stoppedOn: '',
  dosePrompt: false,
  active: true,
};
export function SupplementsSection({ date }: { date: string }) {
  const n = useNutrition(date);
  const [manage, setManage] = useState(false);
  const [prompt, setPrompt] = useState<Supplement | null>(null);
  const [amount, setAmount] = useState('');
  const [vial, setVial] = useState<Supplement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const active = bySortOrder(n.view.supplements).filter(
    (s) =>
      s.active &&
      (!s.startedOn || s.startedOn <= date) &&
      (!s.stoppedOn || s.stoppedOn >= date),
  );
  // Per supplement, like the current app's `toggling` set: a second tap before the first write
  // lands would read the same `loggedToday` and queue a second dose.
  const inFlight = useRef(new Set<string>());
  const [toggling, setToggling] = useState<ReadonlySet<string>>(() => new Set());
  async function toggle(s: Supplement, dose?: number) {
    if (inFlight.current.has(s.id)) return;
    inFlight.current.add(s.id);
    setToggling(new Set(inFlight.current));
    try {
      await n.store?.logSupplement(s, date, dose);
      setPrompt(null);
      setError(null);
    } catch {
      setError('Could not save the dose.');
    } finally {
      inFlight.current.delete(s.id);
      setToggling(new Set(inFlight.current));
    }
  }
  return (
    <>
      <Stack direction="row" align="center" justify="space-between">
        <AppText variant="eyebrow" tone="muted">
          Supplements
        </AppText>
        <StatusIndicator label="Supplements" error={error} busy={n.syncing} />
        <AppButton title="Manage" variant="ghost" onPress={() => setManage(true)} />
      </Stack>
      {active.length ? (
        active.map((s) => (
          <Stack key={s.id} direction="row" align="center">
            <View style={{ flex: 1, minWidth: 0 }}>
              <ListRow
                title={s.name}
                checked={s.loggedToday}
                leading={<Tick done={s.loggedToday} busy={toggling.has(s.id)} />}
                trailing={false}
                density="snug"
                subtitle={
                  s.loggedAmount?.mixedUnits
                    ? 'Taken · multiple units; total unavailable'
                    : (supplementSubtitle(s) ?? undefined)
                }
                onPress={() => {
                  if (toggling.has(s.id)) return;
                  if (s.dosePrompt && !s.loggedToday) {
                    setPrompt(s);
                    setAmount(s.defaultAmount == null ? '' : String(s.defaultAmount));
                  } else {
                    void toggle(s);
                  }
                }}
              />
            </View>
            {isMilligramDosed(s) && (
              <IconButton
                icon="calculator"
                label={`Vial and dose calculator for ${s.name}`}
                onPress={() => setVial(s)}
              />
            )}
          </Stack>
        ))
      ) : (
        <AppButton
          title="No supplements added yet · Add some"
          variant="surface"
          onPress={() => setManage(true)}
        />
      )}
      {manage && <SupplementManager date={date} onClose={() => setManage(false)} />}
      <Sheet
        visible={prompt !== null}
        title={prompt?.name ?? 'Log dose'}
        onClose={() => setPrompt(null)}
      >
        {prompt && (
          <>
            <AppText tone="muted">How much did you take?</AppText>
            <NumericStepper
              label={prompt.unit ?? 'Amount'}
              value={amount}
              min={0}
              max={1000000}
              step={0.1}
              onChange={setAmount}
            />
            <AppButton
              title="Log"
              disabled={!amount.trim() || !Number.isFinite(Number(amount))}
              onPress={() => void toggle(prompt, Number(amount))}
            />
          </>
        )}
      </Sheet>
      {vial && <VialSheet supplement={vial} onClose={() => setVial(null)} />}
    </>
  );
}
// The current app's one-tap tick: the row itself logs or un-logs the day's dose.
function Tick({ done, busy }: { done: boolean; busy: boolean }) {
  const { theme } = useTheme();
  return (
    <View
      style={{
        width: theme.sizes.iconSmall,
        height: theme.sizes.iconSmall,
        borderRadius: theme.radii.pill,
        borderWidth: 2,
        borderColor: done ? theme.colors.brand : theme.colors.muted,
        backgroundColor: done ? theme.colors.brand : 'transparent',
        alignItems: 'center',
        justifyContent: 'center',
        opacity: busy ? 0.5 : 1,
      }}
    >
      {done && <Icon name="check" color={theme.colors.onBrand} size={theme.sizes.iconSmall - 8} />}
    </View>
  );
}
// The view appends an edited row after the rest, so the stored order is applied here.
function bySortOrder(list: readonly Supplement[]) {
  return list.slice().sort((a, b) => a.sortOrder - b.sortOrder);
}
// One supplement's full write, so a toggle or a reorder never blanks the fields it did not touch.
function supplementPayload(s: Supplement, patch: Partial<Pick<Supplement, 'active' | 'sortOrder'>>) {
  const next = { ...s, ...patch };
  return {
    ...SupplementCreateSchema.parse({
      name: next.name,
      dose: next.dose ?? null,
      defaultAmount: next.defaultAmount ?? null,
      unit: next.unit ?? null,
      startedOn: next.startedOn ?? null,
      stoppedOn: next.stoppedOn ?? null,
      dosePrompt: next.dosePrompt,
      active: next.active,
      reminderEnabled: next.reminderEnabled,
      reminderTime: next.reminderTime ?? null,
      sortOrder: next.sortOrder,
    }),
    id: s.id,
  };
}
function SupplementManager({ date, onClose }: { date: string; onClose: () => void }) {
  const n = useNutrition(date);
  const resources = useWorkoutResources();
  const [busy, setBusy] = useState(false);
  const [edit, setEdit] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [seed, setSeed] = useState(blank);
  const [remove, setRemove] = useState<Supplement | null>(null);
  const draft = useWorkoutDraft(`supplement-editor:${edit ?? 'closed'}`, formSchema, seed);
  const f = draft.value;
  const { theme } = useTheme();
  const ordered = bySortOrder(n.view.supplements);
  function open(s: Supplement) {
    setEdit(s.id);
    setSeed({
      name: s.name,
      dose: s.dose ?? '',
      defaultAmount: s.defaultAmount == null ? '' : String(s.defaultAmount),
      unit: s.unit ?? '',
      startedOn: s.startedOn ?? '',
      stoppedOn: s.stoppedOn ?? '',
      dosePrompt: s.dosePrompt,
      active: s.active,
    });
  }
  async function toggleActive(s: Supplement) {
    if (busy) return;
    setBusy(true);
    try {
      await n.store?.enqueue([
        { domain: 'supplements', date, payload: supplementPayload(s, { active: !s.active }) },
      ]);
      setError(null);
    } catch {
      setError('Could not change this supplement.');
    } finally {
      setBusy(false);
    }
  }
  async function reorder(ids: string[]) {
    if (busy) return;
    setBusy(true);
    try {
      const changed = ids.flatMap((id, index) => {
        const s = ordered.find((x) => x.id === id);
        return s && s.sortOrder !== index ? [{ s, index }] : [];
      });
      await n.store?.enqueue(
        changed.map(({ s, index }) => ({
          domain: 'supplements' as const,
          date,
          payload: supplementPayload(s, { sortOrder: index }),
        })),
      );
      setError(null);
    } catch {
      setError('Could not save the new order.');
    } finally {
      setBusy(false);
    }
  }
  async function save() {
    if (busy) {
      return;
    }
    setBusy(true);
    try {
      const body = SupplementCreateSchema.parse({
        name: f.name.trim(),
        dose: f.dose.trim() || null,
        defaultAmount: f.defaultAmount.trim() ? Number(f.defaultAmount) : null,
        unit: f.unit.trim() || null,
        startedOn: f.startedOn.trim() || null,
        stoppedOn: f.stoppedOn.trim() || null,
        dosePrompt: f.dosePrompt,
        active: f.active,
        reminderEnabled:
          n.view.supplements.find((x) => x.id === edit)?.reminderEnabled ?? false,
        reminderTime: n.view.supplements.find((x) => x.id === edit)?.reminderTime ?? null,
        sortOrder:
          edit === 'new'
            ? n.view.supplements.length
            : (n.view.supplements.find((x) => x.id === edit)?.sortOrder ?? 0),
      });
      await n.store?.enqueue([
        {
          domain: 'supplements',
          date,
          payload: { ...body, id: edit === 'new' ? randomUUID() : edit! },
        },
      ]);
      await resources?.clearDraft(`supplement-editor:${edit}`);
      setEdit(null);
      setError(null);
    } catch {
      setError('Check the name, dates and dose amount. Your draft is preserved.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Sheet
      visible
      fullHeight
      title="Manage supplements"
      onClose={onClose}
      footer={
        edit ? undefined : (
          <AppButton
            title="Add supplement"
            icon="plus"
            onPress={() => {
              setSeed(blank);
              setEdit('new');
            }}
          />
        )
      }
      actions={
        <StatusIndicator
          label="Supplement editor"
          error={error ?? draft.error}
          busy={busy || !draft.ready}
        />
      }
    >
      {edit ? (
        <>
          <TextField
            label="Name"
            value={f.name}
            onChangeText={(name) => draft.setValue({ ...f, name })}
          />
          <TextField
            label="Dose description"
            value={f.dose}
            onChangeText={(dose) => draft.setValue({ ...f, dose })}
          />
          <Grid columns={2}>
            <TextField
              label="Default amount"
              keyboardType="decimal-pad"
              value={f.defaultAmount}
              onChangeText={(defaultAmount) => draft.setValue({ ...f, defaultAmount })}
            />
            <TextField
              label="Unit"
              value={f.unit}
              onChangeText={(unit) => draft.setValue({ ...f, unit })}
            />
          </Grid>
          <SwitchRow
            label="Ask me when logging"
            value={f.dosePrompt}
            onValueChange={(dosePrompt) => draft.setValue({ ...f, dosePrompt })}
          />
          <TextField
            label="Started on (YYYY-MM-DD)"
            value={f.startedOn}
            onChangeText={(startedOn) => draft.setValue({ ...f, startedOn })}
          />
          <TextField
            label="Stopped on (optional)"
            value={f.stoppedOn}
            onChangeText={(stoppedOn) => draft.setValue({ ...f, stoppedOn })}
          />
          <SwitchRow
            label="Active"
            value={f.active}
            onValueChange={(active) => draft.setValue({ ...f, active })}
          />
          <AppButton
            title="Save supplement"
            busy={busy}
            disabled={!draft.ready}
            onPress={() => void save()}
          />
          {edit !== 'new' && (
            <AppButton
              title="Delete"
              variant="danger"
              onPress={() => setRemove(n.view.supplements.find((x) => x.id === edit) ?? null)}
            />
          )}
          <AppButton title="Back" variant="ghost" onPress={() => setEdit(null)} />
        </>
      ) : (
        <>
          {ordered.length === 0 && (
            <AppText tone="muted">No supplements yet. Add one below.</AppText>
          )}
          <SortableStack
            order={ordered.map((x) => x.id)}
            enabled={!busy}
            label={(id) => ordered.find((x) => x.id === id)?.name ?? 'Supplement'}
            onChange={(ids) => void reorder(ids)}
            renderItem={(id, handle) => {
              const s = ordered.find((x) => x.id === id);
              if (!s) return null;
              const dose = definitionDose(s);
              return (
                <Card key={id} style={{ paddingVertical: 0 }}>
                  <Stack direction="row" align="center" gap="sm">
                    {handle}
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <ListRow
                        title={s.name}
                        subtitle={
                          [
                            dose,
                            hasFreeTextBesideAmount(s) ? `Note: ${s.dose}` : null,
                            s.reminderEnabled && s.reminderTime ? s.reminderTime : null,
                          ]
                            .filter(Boolean)
                            .join(' · ') || undefined
                        }
                        onPress={() => open(s)}
                      />
                    </View>
                    <Switch
                      accessibilityLabel={`${s.name} active`}
                      value={s.active}
                      disabled={busy}
                      onValueChange={() => void toggleActive(s)}
                      trackColor={{ false: theme.colors.raised, true: theme.colors.brand }}
                    />
                  </Stack>
                </Card>
              );
            }}
          />
        </>
      )}
      {remove && (
        <ConfirmationCard
          title={'Delete ' + remove.name + '?'}
          message="Recorded history is kept."
          confirmLabel="Delete"
          cancelLabel="Cancel"
          danger
          onCancel={() => setRemove(null)}
          onConfirm={async () => {
            try {
              await deleteSupplement(
                {
                  enqueue: (ops) => n.store!.enqueue(ops),
                  clearDraft: async (key) => resources?.clearDraft(key),
                },
                date,
                remove.id,
              );
              setEdit(null);
              setRemove(null);
            } catch {
              setError('Could not delete this supplement.');
            }
          }}
        />
      )}
      <AppText variant="label">Supplement reminders</AppText>
      <NutritionReminders kind="supplement" />
    </Sheet>
  );
}
