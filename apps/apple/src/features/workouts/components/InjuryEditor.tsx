import { z } from 'zod';
import { useState } from 'react';
import { randomUUID } from 'expo-crypto';
import { todayInTz } from '@trainingai/shared/date-utils';
import { InjuryCreateSchema } from '@trainingai/shared/validation/injury';
import { AppButton, AppText, Notice, Picker, Stack, TextField } from '../../../shared/ui';
import { useWorkoutResources } from '../data/WorkoutDataProvider';
import { injurySpec } from '../data/models';
import { useWorkoutAction } from '../data/useWorkoutAction';
import { useWorkoutDraft } from '../data/useWorkoutDraft';
import { useWorkoutContext } from '../WorkoutProvider';

export type InjuryRecord = z.infer<typeof injurySpec.schema>[number];
const muscles = [
  'chest',
  'shoulders',
  'biceps',
  'triceps',
  'forearms',
  'abs',
  'obliques',
  'hip flexors',
  'quads',
  'hamstrings',
  'glutes',
  'calves',
  'adductors',
  'traps',
  'upper back',
  'lats',
  'lower back',
];
const schema = z.object({
  muscleName: z.string(),
  severity: z.enum(['mild', 'moderate', 'severe']),
  notes: z.string().nullable(),
  startedDate: z.string(),
});
export function InjuryEditor({ injury, onSaved }: { injury?: InjuryRecord; onSaved: () => void }) {
  const resources = useWorkoutResources();
  const workouts = useWorkoutContext();
  const action = useWorkoutAction();
  const [recordId] = useState(() => injury?.id ?? randomUUID());
  const key = `injury-editor:${injury?.id ?? 'new'}`;
  const draft = useWorkoutDraft(key, schema, {
    muscleName: injury?.muscleName ?? '',
    severity: injury?.severity ?? 'mild',
    notes: injury?.notes ?? null,
    startedDate: injury?.startedDate ?? todayInTz(workouts.timezone),
  });
  async function save() {
    await action.run(async () => {
      if (!resources) {
        throw new Error('Sign in to save this injury.');
      }
      const body = InjuryCreateSchema.parse({
        ...draft.value,
        notes: draft.value.notes?.trim() || null,
      });
      await resources.changes.saveInjury(
        { ...body, startedDate: draft.value.startedDate, notes: body.notes ?? null },
        recordId,
      );
      await resources.clearDraft(key);
      onSaved();
    });
  }
  if (!draft.ready) {
    return <AppText tone="muted">{draft.error ?? 'Loading saved draft…'}</AppText>;
  }
  return (
    <>
      {(draft.error || action.error) && (
        <Notice title="Injury record" message={draft.error ?? action.error!} />
      )}
      <Stack pointerEvents={action.busy ? 'none' : 'auto'}>
        <Picker
          label="Muscle"
          value={draft.value.muscleName.toLowerCase()}
          options={[
            ...new Set([...muscles, ...(injury ? [injury.muscleName.toLowerCase()] : [])]),
          ].map((value) => ({ value, label: value }))}
          onChange={(muscleName) => draft.setValue({ ...draft.value, muscleName })}
        />
        <Picker
          label="Severity"
          value={draft.value.severity}
          options={['mild', 'moderate', 'severe'].map((value) => ({
            value,
            label: value[0].toUpperCase() + value.slice(1),
          }))}
          onChange={(severity) =>
            draft.setValue({ ...draft.value, severity: severity as typeof draft.value.severity })
          }
        />
        <TextField
          label="Started date (YYYY-MM-DD)"
          value={draft.value.startedDate}
          onChangeText={(startedDate) => draft.setValue({ ...draft.value, startedDate })}
        />
        <TextField
          label="Notes"
          multiline
          value={draft.value.notes ?? ''}
          onChangeText={(notes) => draft.setValue({ ...draft.value, notes })}
          maxLength={1000}
        />
      </Stack>
      <AppButton
        title="Save Injury"
        busy={action.busy}
        onPress={() => {
          void save();
        }}
      />
    </>
  );
}
