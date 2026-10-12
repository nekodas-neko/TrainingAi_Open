import { randomUUID } from 'expo-crypto';
import { useState } from 'react';
import { z } from 'zod';
import {
  AppButton,
  AppText,
  Card,
  ConfirmationCard,
  Grid,
  IconButton,
  ListRow,
  NumericStepper,
  Sheet,
  Stack,
  StatusIndicator,
  SwitchRow,
  TextField,
} from '../../../shared/ui';
import { useWorkoutResources } from '../../workouts/data/WorkoutDataProvider';
import { useWorkoutDraft } from '../../workouts/data/useWorkoutDraft';
import { useNutrition } from '../data/NutritionProvider';
import { SupplementCreateSchema, type Supplement } from '../data/models';
import { VialSheet } from './VialSheet';
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
  const active = n.view.supplements.filter(
    (s) =>
      s.active &&
      (!s.startedOn || s.startedOn <= date) &&
      (!s.stoppedOn || s.stoppedOn >= date),
  );
  async function toggle(s: Supplement, dose?: number) {
    try {
      await n.store?.logSupplement(s, date, dose);
      setPrompt(null);
    } catch {
      setError('Could not save the dose.');
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
            <ListRow
              title={`${s.loggedToday ? '✓ ' : ''}${s.name}`}
              subtitle={
                s.loggedAmount?.mixedUnits
                  ? 'Taken · multiple units; total unavailable'
                  : s.loggedAmount?.amount != null
                    ? `${s.loggedAmount.amount} ${s.loggedAmount.unit ?? ''} today${s.loggedAmount.contributions > 1 ? ' · ' + s.loggedAmount.contributions + ' doses' : ''}`
                    : `${s.defaultAmount ?? s.dose ?? ''} ${s.unit ?? ''}`
              }
              onPress={() => {
                if (s.dosePrompt && !s.loggedToday) {
                  setPrompt(s);
                  setAmount(s.defaultAmount == null ? '' : String(s.defaultAmount));
                } else {
                  void toggle(s);
                }
              }}
            />
            {s.unit?.toLowerCase() === 'mg' && (
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
          <AppButton title="Back" variant="ghost" onPress={() => setEdit(null)} />
        </>
      ) : (
        <>
          <AppButton
            title="Add supplement"
            onPress={() => {
              setSeed(blank);
              setEdit('new');
            }}
          />
          {n.view.supplements.map((s) => (
            <Card key={s.id}>
              <ListRow
                title={s.name}
                subtitle={`${s.dose ?? ''} · ${s.active ? 'Active' : 'Inactive'}`}
                onPress={() => {
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
                }}
              />
              <AppButton title="Delete" variant="danger" onPress={() => setRemove(s)} />
            </Card>
          ))}
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
              await n.store!.enqueue([
                { domain: 'supplements', date, payload: { id: remove.id, deleted: true } },
              ]);
              setRemove(null);
            } catch {
              setError('Could not delete this supplement.');
            }
          }}
        />
      )}
      <SwitchRow
        label="Supplement reminders · Coming soon"
        value={false}
        disabled
        onValueChange={() => {}}
      />
    </Sheet>
  );
}
