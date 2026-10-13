import { z } from 'zod';
import { PhaseSetWriteBody, PHASE_TYPES } from '@trainingai/shared/validation/phase-set';
import {
  AppButton,
  AppText,
  Card,
  Notice,
  NumericStepper,
  Picker,
  Stack,
  TextField,
} from '../../shared/ui';
import { WorkoutLayout } from '../workouts/components/WorkoutLayout';
import { phaseSetsSpec, stylesSpec, type SavedPhaseSet } from '../workouts/data/models';
import { useWorkoutResource } from '../workouts/data/WorkoutDataProvider';
import { useWorkoutDraft } from '../workouts/data/useWorkoutDraft';
import { useWorkoutAction } from '../workouts/data/useWorkoutAction';
import { moveItem } from './editor-model';
import { useWorkoutContext } from '../workouts/WorkoutProvider';

const PhaseDraft = PhaseSetWriteBody.extend({
  name: z.string(),
  phases: PhaseSetWriteBody.shape.phases.unwrap().element.extend({ name: z.string() }).array(),
});
export function PhaseEditor({ phase, onClose }: { phase?: SavedPhaseSet; onClose: () => void }) {
  const styles = useWorkoutResource(stylesSpec);
  const action = useWorkoutAction();
  const workouts = useWorkoutContext();
  const draft = useWorkoutDraft(`phase-editor:${phase?.id ?? 'new'}`, PhaseDraft, {
    name: phase?.name ?? '',
    phases:
      phase?.phases.map((item) => ({
        name: item.name,
        durationCycles: item.durationCycles,
        phaseType: item.phaseType,
        primaryStyleId: item.primaryStyleId ?? undefined,
        secondaryStyleId: item.secondaryStyleId ?? undefined,
      })) ?? [],
  });
  const value = draft.value;
  async function save() {
    await action.run(async () => {
      if (!draft.resources) {
        throw new Error('Sign in to save phase sets.');
      }
      const body = PhaseSetWriteBody.parse(value);
      await draft.resources.write(
        phase ? 'PUT' : 'POST',
        phase ? `/api/phase-sets/${phase.id}` : '/api/phase-sets',
        body,
        ['/api/phase-sets', '/api/workout-data'],
      );
      await draft.resources.clearDraft(`phase-editor:${phase?.id ?? 'new'}`);
      await draft.resources.load(phaseSetsSpec, true);
      workouts.invalidate();
      onClose();
    });
  }
  function update(at: number, patch: Partial<(typeof value.phases)[number]>) {
    draft.setValue({
      ...value,
      phases: value.phases.map((phase, index) => (index === at ? { ...phase, ...patch } : phase)),
    });
  }
  if (!draft.ready) {
    return (
      <WorkoutLayout title="Phase Set" onBack={onClose}>
        <AppText tone="muted">{draft.error ?? 'Loading saved draft…'}</AppText>
      </WorkoutLayout>
    );
  }
  return (
    <WorkoutLayout
      contentDisabled={action.busy}
      title={phase ? 'Edit Phase Set' : 'New Phase Set'}
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
        <Notice title="Phase set" message={draft.error ?? action.error!} />
      )}
      <TextField
        label="Name"
        editable={!phase?.isDefault}
        value={value.name}
        onChangeText={(name) => draft.setValue({ ...value, name })}
      />
      {value.phases.map((item, index) => (
        <Card key={index}>
          <TextField
            label={`Phase ${index + 1}`}
            value={item.name}
            onChangeText={(name) => update(index, { name })}
          />
          <Picker
            label="Phase type"
            value={item.phaseType}
            options={PHASE_TYPES.map((type) => ({
              value: type,
              label: type[0].toUpperCase() + type.slice(1),
            }))}
            onChange={(phaseType) =>
              update(index, { phaseType: phaseType as typeof item.phaseType })
            }
          />
          <NumericStepper
            label="Cycles"
            min={0}
            max={52}
            value={String(item.durationCycles)}
            onChange={(value) => update(index, { durationCycles: Number(value) })}
          />
          {(['primaryStyleId', 'secondaryStyleId'] as const).map((field) => (
            <Picker
              key={field}
              label={
                field === 'primaryStyleId' ? 'Primary progression set' : 'Secondary progression set'
              }
              value={item[field] ?? ''}
              options={[
                { value: '', label: 'Default' },
                ...(styles.data?.styles ?? []).map((style) => ({
                  value: style.id,
                  label: style.name,
                })),
              ]}
              onChange={(id) => update(index, { [field]: id || undefined })}
            />
          ))}
          <Stack direction="row">
            <AppButton
              title="↑"
              variant="ghost"
              disabled={index === 0}
              onPress={() =>
                draft.setValue({ ...value, phases: moveItem(value.phases, index, -1) })
              }
            />
            <AppButton
              title="↓"
              variant="ghost"
              disabled={index === value.phases.length - 1}
              onPress={() => draft.setValue({ ...value, phases: moveItem(value.phases, index, 1) })}
            />
            <AppButton
              title="Remove"
              variant="danger"
              onPress={() =>
                draft.setValue({ ...value, phases: value.phases.filter((_, at) => at !== index) })
              }
            />
          </Stack>
        </Card>
      ))}
      <AppButton
        title="Add Phase"
        variant="secondary"
        onPress={() =>
          draft.setValue({
            ...value,
            phases: [
              ...value.phases,
              {
                name: '',
                phaseType: 'normal',
                durationCycles: 1,
                primaryStyleId: undefined,
                secondaryStyleId: undefined,
              },
            ],
          })
        }
      />
    </WorkoutLayout>
  );
}
