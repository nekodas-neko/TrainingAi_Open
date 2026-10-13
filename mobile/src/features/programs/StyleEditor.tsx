import { z } from 'zod';
import { ProgressionStyleSaveSchema } from '@trainingai/shared/validation/progression-style';
import {
  AppButton,
  AppText,
  Card,
  Notice,
  NumericStepper,
  Stack,
  SwitchRow,
  TextField,
} from '../../shared/ui';
import { WorkoutLayout } from '../workouts/components/WorkoutLayout';
import { stylesSpec, type SavedStyle } from '../workouts/data/models';
import { useWorkoutDraft } from '../workouts/data/useWorkoutDraft';
import { useWorkoutAction } from '../workouts/data/useWorkoutAction';
import { useWorkoutContext } from '../workouts/WorkoutProvider';

const Draft = ProgressionStyleSaveSchema.extend({ name: z.string() });
export function StyleEditor({ style, onClose }: { style?: SavedStyle; onClose: () => void }) {
  const draft = useWorkoutDraft(`style-editor:${style?.id ?? 'new'}`, Draft, {
    id: style?.id,
    name: style?.name ?? '',
    sets: style?.sets.map((set) => ({
      id: set.id,
      setNumber: set.setNumber,
      pct: set.pct,
      reps: set.reps,
      restSec: set.restSec,
      useFor1rm: set.useFor1rm,
    })) ?? [{ setNumber: 1, pct: 70, reps: 8, restSec: 90, useFor1rm: true }],
  });
  const action = useWorkoutAction();
  const workouts = useWorkoutContext();
  const value = draft.value;
  function update(index: number, patch: Partial<(typeof value.sets)[number]>) {
    draft.setValue({
      ...value,
      sets: value.sets.map((set, at) => (at === index ? { ...set, ...patch } : set)),
    });
  }
  async function save() {
    await action.run(async () => {
      const body = ProgressionStyleSaveSchema.parse({
        ...value,
        sets: value.sets.map((set, index) => ({ ...set, setNumber: index + 1 })),
      });
      if (!draft.resources) {
        throw new Error('Sign in to save progression sets.');
      }
      await draft.resources.write('POST', '/api/progression-styles', { style: body }, [
        '/api/progression-styles',
        '/api/workout-data',
      ]);
      await draft.resources.clearDraft(`style-editor:${style?.id ?? 'new'}`);
      await draft.resources.load(stylesSpec, true);
      workouts.invalidate();
      onClose();
    });
  }
  if (!draft.ready) {
    return (
      <WorkoutLayout title="Progression Set" onBack={onClose}>
        <AppText tone="muted">{draft.error ?? 'Loading saved draft…'}</AppText>
      </WorkoutLayout>
    );
  }
  return (
    <WorkoutLayout
      contentDisabled={action.busy}
      title={style ? 'Edit Progression Set' : 'New Progression Set'}
      onBack={action.busy ? undefined : onClose}
      footer={
        <AppButton
          title="Save"
          disabled={!draft.ready}
          busy={action.busy}
          onPress={() => {
            void save();
          }}
        />
      }
    >
      {(draft.error || action.error) && (
        <Notice title="Progression set" message={draft.error ?? action.error!} />
      )}
      <TextField
        label="Name"
        value={value.name}
        onChangeText={(name) => draft.setValue({ ...value, name })}
      />
      {value.sets.map((set, index) => (
        <Card key={index}>
          <AppText variant="heading">Set {index + 1}</AppText>
          <Stack direction="row">
            <NumericStepper
              label="% 1RM"
              min={0}
              max={300}
              step={5}
              value={String(set.pct)}
              onChange={(value) => update(index, { pct: Number(value) })}
            />
            <NumericStepper
              label="Reps"
              min={0}
              max={100}
              value={String(set.reps)}
              onChange={(value) => update(index, { reps: Number(value) })}
            />
          </Stack>
          <NumericStepper
            label="Rest (seconds)"
            min={0}
            max={3600}
            step={15}
            value={String(set.restSec)}
            onChange={(value) => update(index, { restSec: Number(value) })}
          />
          <SwitchRow
            label="Use for 1RM estimate"
            value={set.useFor1rm}
            onValueChange={(useFor1rm) => update(index, { useFor1rm })}
          />
          <AppButton
            title="Remove set"
            variant="danger"
            onPress={() =>
              draft.setValue({ ...value, sets: value.sets.filter((_, at) => at !== index) })
            }
          />
        </Card>
      ))}
      <AppButton
        title="Add Set"
        variant="secondary"
        disabled={value.sets.length >= 40}
        onPress={() =>
          draft.setValue({
            ...value,
            sets: [
              ...value.sets,
              { setNumber: value.sets.length + 1, pct: 70, reps: 8, restSec: 90, useFor1rm: true },
            ],
          })
        }
      />
    </WorkoutLayout>
  );
}
