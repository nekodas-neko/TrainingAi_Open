import { useState } from 'react';
import { todayInTz } from '@trainingai/shared/date-utils';
import {
  AppButton,
  AppText,
  Card,
  ConfirmationCard,
  Disclosure,
  Notice,
  Sheet,
  Stack,
} from '../../../shared/ui';
import { useWorkoutResource } from '../data/WorkoutDataProvider';
import { injurySpec } from '../data/models';
import { useWorkoutAction } from '../data/useWorkoutAction';
import { useWorkoutContext } from '../WorkoutProvider';
import { ResourceStatus } from './ResourceStatus';
import { InjuryEditor, type InjuryRecord } from './InjuryEditor';
import { TrainingSyncNotice } from './TrainingSyncNotice';

export function InjuryManager({ showSync = true }: { showSync?: boolean }) {
  const state = useWorkoutResource(injurySpec);
  const action = useWorkoutAction();
  const workouts = useWorkoutContext();
  const [editing, setEditing] = useState<InjuryRecord | 'new' | null>(null);
  const [deleting, setDeleting] = useState<InjuryRecord | null>(null);
  const active = state.data?.filter((injury) => !injury.resolvedDate) ?? [];
  const resolved = state.data?.filter((injury) => injury.resolvedDate) ?? [];
  async function change(injury: InjuryRecord, method: 'PATCH' | 'DELETE') {
    await action.run(async () => {
      if (!state.resources) {
        throw new Error('Sign in to change this injury.');
      }
      await state.resources.changes.changeInjury(
        injury.id,
        method === 'PATCH' ? todayInTz(workouts.timezone) : undefined,
      );
      setDeleting(null);
    });
  }
  return (
    <>
      <ResourceStatus state={state} refresh={state.refresh} />
      {showSync && <TrainingSyncNotice />}
      {action.error && <Notice title="Injury record" message={action.error} />}
      <AppButton title="Record Injury" onPress={() => setEditing('new')} />
      {state.data && !active.length && <AppText tone="muted">No active injuries</AppText>}
      {active.map((injury) => (
        <Card key={injury.id}>
          <AppText variant="heading">{injury.muscleName}</AppText>
          <AppText variant="caption" tone="muted">
            {injury.severity} · since {injury.startedDate}
          </AppText>
          {injury.notes && <AppText>{injury.notes}</AppText>}
          <Stack direction="row" wrap>
            <AppButton
              title="Edit"
              variant="surface"
              disabled={action.busy}
              onPress={() => setEditing(injury)}
            />
            <AppButton
              title="Mark resolved"
              variant="surface"
              busy={action.busy}
              onPress={() => {
                void change(injury, 'PATCH');
              }}
            />
            <AppButton
              title="Delete"
              variant="danger"
              disabled={action.busy}
              onPress={() => setDeleting(injury)}
            />
          </Stack>
        </Card>
      ))}
      {!!resolved.length && (
        <Disclosure title={'Resolved (' + resolved.length + ')'}>
          {resolved.map((injury) => (
            <Card key={injury.id}>
              <AppText variant="label">{injury.muscleName}</AppText>
              <AppText variant="caption" tone="muted">
                Resolved {injury.resolvedDate}
              </AppText>
            </Card>
          ))}
        </Disclosure>
      )}
      <Sheet
        visible={editing !== null}
        title={editing === 'new' ? 'Record Injury' : 'Edit Injury'}
        onClose={() => setEditing(null)}
      >
        {editing && (
          <InjuryEditor
            key={editing === 'new' ? 'new' : editing.id}
            injury={editing === 'new' ? undefined : editing}
            onSaved={() => setEditing(null)}
          />
        )}
      </Sheet>
      <Sheet visible={deleting !== null} title="Delete injury" onClose={() => setDeleting(null)}>
        {action.error && <Notice title="Injury record" message={action.error} />}
        {deleting && (
          <ConfirmationCard
            title={'Delete ' + deleting.muscleName + ' injury?'}
            message="This removes the recorded injury from your account."
            confirmLabel="Delete"
            cancelLabel="Cancel"
            danger
            busy={action.busy}
            onConfirm={() => {
              void change(deleting, 'DELETE');
            }}
            onCancel={() => setDeleting(null)}
          />
        )}
      </Sheet>
    </>
  );
}
