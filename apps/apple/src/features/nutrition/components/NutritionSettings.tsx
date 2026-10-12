import {
  caloriesFromMacros,
  carbsFromRemainder,
  MACRO_GOAL_TOLERANCE_KCAL,
} from '@trainingai/shared/nutrition/goal-recommendation';
import { useEffect, useState } from 'react';
import { z } from 'zod';
import {
  AppButton,
  AppText,
  Card,
  Grid,
  ListRow,
  NumericStepper,
  Picker,
  Sheet,
  Skeleton,
  Stack,
  StatusIndicator,
  SwitchRow,
  TextField,
} from '../../../shared/ui';
import { ApiError } from '../../account/api/client';
import { useWorkoutResources } from '../../workouts/data/WorkoutDataProvider';
import { useWorkoutDraft } from '../../workouts/data/useWorkoutDraft';
import { useNutrition } from '../data/NutritionProvider';
import { mealTypeBody } from '../data/models';
import { GoalRecommendation } from './GoalRecommendation';
const formSchema = z.object({
  name: z.string(),
  emoji: z.string(),
  timeStartHour: z.string(),
  timeEndHour: z.string(),
  required: z.boolean(),
});
const empty = { name: '', emoji: '🍽️', timeStartHour: '0', timeEndHour: '24', required: true };
export function NutritionSettings({ onClose }: { onClose: () => void }) {
  const n = useNutrition();
  const resources = useWorkoutResources();
  const [edit, setEdit] = useState<string | null>(null);
  const [seed, setSeed] = useState(empty);
  const [remove, setRemove] = useState<string | null>(null);
  const [reassign, setReassign] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const draft = useWorkoutDraft(`meal-type-editor:${edit ?? 'new'}`, formSchema, seed);
  const f = draft.value;
  async function action(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await n.store?.refresh('mealTypes', n.today, true);
    } catch (cause) {
      setError(
        cause instanceof ApiError && cause.status === 409
          ? 'This group has food entries. Move them to another group before deleting it.'
          : remove !== null
            ? 'Could not delete this meal group. Check your connection and try again.'
            : 'Could not save. Your draft is preserved; retry when connected.',
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <Sheet
      visible
      fullHeight
      title={
        remove !== null
          ? 'Delete meal type'
          : edit === 'new'
            ? 'Add meal type'
            : edit !== null
              ? 'Edit meal type'
              : 'Nutrition Settings'
      }
      onClose={() => {
        if (busy) {
          return;
        }
        setError(null);
        if (remove !== null) {
          setRemove(null);
        } else if (edit !== null) {
          setEdit(null);
        } else {
          onClose();
        }
      }}
      actions={
        <StatusIndicator
          label={
            remove !== null
              ? 'Delete meal group'
              : edit !== null
                ? 'Meal group'
                : 'Nutrition settings'
          }
          error={error ?? (edit !== null ? draft.error : n.errors.mealTypes)}
          busy={busy || (edit !== null && !draft.ready)}
        />
      }
    >
      {remove === null && edit === null ? (
        <>
          <AppText variant="eyebrow" tone="muted">
            Meal Reminders
          </AppText>
          <SwitchRow
            label="Remind me to log meals · Coming soon"
            value={false}
            disabled
            onValueChange={() => {}}
          />
          <AppText variant="eyebrow" tone="muted">
            Meal Types
          </AppText>
          {n.view.mealTypes.map((mt, index) => (
            <Card key={mt.id}>
              <ListRow
                title={mt.emoji + ' ' + mt.name}
                subtitle={`${mt.timeStartHour}:00–${mt.timeEndHour}:00 · ${mt.required ? 'Required' : 'Optional'}`}
                onPress={() => {
                  setError(null);
                  setSeed({
                    name: mt.name,
                    emoji: mt.emoji,
                    timeStartHour: String(mt.timeStartHour),
                    timeEndHour: String(mt.timeEndHour),
                    required: mt.required,
                  });
                  setEdit(mt.id);
                }}
              />
              <Stack direction="row">
                <AppButton
                  title="Move up"
                  variant="ghost"
                  disabled={busy || index === 0}
                  onPress={() =>
                    void action(() => {
                      const ids = n.view.mealTypes.map((x) => x.id);
                      [ids[index - 1], ids[index]] = [ids[index], ids[index - 1]];
                      return resources!.write(
                        'PATCH',
                        '/api/nutrition/meal-types',
                        { orderedIds: ids },
                        ['/api/nutrition/meal-types'],
                      );
                    })
                  }
                />
                <AppButton
                  title="Delete"
                  variant="danger"
                  disabled={busy}
                  accessibilityLabel={`Delete ${mt.name}`}
                  onPress={() => {
                    setError(null);
                    setRemove(mt.id);
                    setReassign('');
                  }}
                />
              </Stack>
            </Card>
          ))}
          <AppButton
            title="Add meal type"
            disabled={busy}
            onPress={() => {
              setError(null);
              setSeed(empty);
              setEdit('new');
            }}
          />
        </>
      ) : edit !== null ? (
        <>
          <TextField
            label="Name"
            value={f.name}
            onChangeText={(name) => draft.setValue({ ...f, name })}
          />
          <TextField
            label="Emoji"
            value={f.emoji}
            onChangeText={(emoji) => draft.setValue({ ...f, emoji })}
          />
          <Grid columns={2}>
            <NumericStepper
              label="Window starts (hour)"
              value={f.timeStartHour}
              min={0}
              max={23}
              onChange={(timeStartHour) => draft.setValue({ ...f, timeStartHour })}
            />
            <NumericStepper
              label="Window ends (hour)"
              value={f.timeEndHour}
              min={0}
              max={24}
              onChange={(timeEndHour) => draft.setValue({ ...f, timeEndHour })}
            />
          </Grid>
          <SwitchRow
            label="Required meal"
            value={f.required}
            onValueChange={(required) => draft.setValue({ ...f, required })}
          />
          <AppButton
            title="Save"
            disabled={!draft.ready}
            busy={busy}
            onPress={() =>
              void action(async () => {
                const existing = n.view.mealTypes.find((x) => x.id === edit);
                const payload = mealTypeBody.parse({
                  ...f,
                  timeStartHour: Number(f.timeStartHour),
                  timeEndHour: Number(f.timeEndHour),
                  sortOrder: existing?.sortOrder ?? n.view.mealTypes.length,
                  remindersEnabled: existing?.remindersEnabled ?? false,
                });
                await resources!.write(
                  edit === 'new' ? 'POST' : 'PUT',
                  `/api/nutrition/meal-types${edit === 'new' ? '' : '/' + edit}`,
                  payload,
                  ['/api/nutrition/meal-types'],
                );
                setEdit(null);
              })
            }
          />
        </>
      ) : (
        <>
          <AppText>
            Delete {n.view.mealTypes.find((mt) => mt.id === remove)?.name ?? 'this meal group'}?
            If it has food entries, choose another group to keep them in. Empty groups can be
            deleted directly.
          </AppText>
          <Picker
            label="Move entries to"
            value={reassign}
            options={n.view.mealTypes
              .filter((mt) => mt.id !== remove)
              .map((mt) => ({ value: mt.id, label: mt.name }))}
            onChange={setReassign}
          />
          <AppButton
            title="Delete group"
            variant="danger"
            busy={busy}
            onPress={() =>
              void action(async () => {
                if (!resources?.connection.delete) {
                  throw new Error('Unavailable.');
                }
                await resources.connection.delete(
                  `/api/nutrition/meal-types/${remove}`,
                  {},
                  reassign ? { reassignTo: reassign } : undefined,
                );
                resources.invalidate(['/api/nutrition']);
                await n.store?.refresh('logs', n.date, true);
                setRemove(null);
              })
            }
          />
        </>
      )}
    </Sheet>
  );
}
function NutritionTargetsEditor({ onClose }: { onClose: () => void }) {
  const n = useNutrition();
  const resources = useWorkoutResources();
  const schema = z.record(z.string(), z.string());
  const draft = useWorkoutDraft(
    'nutrition-targets-editor',
    schema,
    Object.fromEntries(
      ['calories', 'proteinG', 'carbsG', 'fatG', 'fiberG'].map((key) => [
        key,
        n.view.targets[key] == null ? '' : String(n.view.targets[key]),
      ]),
    ),
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [review, setReview] = useState(false);
  const macros = {
    proteinG: Number(draft.value.proteinG) || 0,
    carbsG: Number(draft.value.carbsG) || 0,
    fatG: Number(draft.value.fatG) || 0,
  };
  const implied = caloriesFromMacros(macros);
  const goal = Number(draft.value.calories);
  const mismatch =
    goal > 0 && implied > 0 && Math.abs(implied - goal) > MACRO_GOAL_TOLERANCE_KCAL;
  return (
    <Sheet
      visible
      fullHeight
      title="Nutrition goals"
      onClose={onClose}
      actions={
        <StatusIndicator
          label="Nutrition goals"
          busy={busy || !draft.ready}
          error={error ?? draft.error}
        />
      }
    >
      <AppText tone="muted">Your daily targets</AppText>
      {['calories', 'proteinG', 'carbsG', 'fatG', 'fiberG'].map((key, i) => (
        <TextField
          key={key}
          label={['Calories (kcal)', 'Protein (g)', 'Carbs (g)', 'Fat (g)', 'Fibre (g)'][i]}
          keyboardType="decimal-pad"
          value={draft.value[key] ?? ''}
          onChangeText={(value) => draft.setValue({ ...draft.value, [key]: value })}
        />
      ))}
      <AppButton
        title="Save targets"
        disabled={!draft.ready}
        onPress={async () => {
          if (busy) {
            return;
          }
          setBusy(true);
          try {
            const payload = Object.fromEntries(
              Object.entries(draft.value)
                .filter(
                  ([key, value]) =>
                    ['calories', 'proteinG', 'carbsG', 'fatG', 'fiberG'].includes(key) &&
                    value.trim(),
                )
                .map(([key, value]) => [key, Number(value)]),
            );
            await n.store?.queueHttp('targets', n.today, payload);
            await resources?.clearDraft('nutrition-targets-editor');
            onClose();
          } catch {
            setError('Check the target amounts. Your draft is preserved.');
          } finally {
            setBusy(false);
          }
        }}
      />
      {mismatch && (
        <Card>
          <AppText>
            Your macros come to {Math.round(implied)} kcal —{' '}
            {Math.abs(Math.round(implied - goal))} {implied > goal ? 'more' : 'less'} than the
            calorie target.
          </AppText>
          <AppButton
            title={'Fit carbs to ' + Math.round(goal) + ' kcal'}
            variant="secondary"
            onPress={() =>
              draft.setValue({
                ...draft.value,
                carbsG: String(carbsFromRemainder(goal, macros.proteinG, macros.fatG)),
              })
            }
          />
        </Card>
      )}
      <AppButton
        title="Review recommended targets"
        variant="secondary"
        onPress={() => setReview(true)}
      />
      {review && (
        <GoalRecommendation
          onClose={() => setReview(false)}
          onApplied={() => {
            void resources?.clearDraft('nutrition-targets-editor').then(onClose);
          }}
        />
      )}
    </Sheet>
  );
}
export function NutritionTargets({ onClose }: { onClose: () => void }) {
  const n = useNutrition();
  useEffect(() => {
    n.refresh();
  }, [n.store]);
  return n.loaded.includes('targets') ? (
    <NutritionTargetsEditor onClose={onClose} />
  ) : (
    <Sheet
      visible
      title="Nutrition goals"
      onClose={onClose}
      actions={
        <StatusIndicator
          label="Nutrition targets"
          busy={n.loading.includes('targets')}
          error={n.errors.targets}
          onRetry={() => n.refresh(true)}
        />
      }
    >
      <Skeleton style={{ height: 240 }} />
    </Sheet>
  );
}
