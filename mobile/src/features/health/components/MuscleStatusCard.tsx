import { useState } from 'react';
import { daysBetweenDateStrs } from '@trainingai/shared/date-utils';
import {
  AppButton,
  AppText,
  Legend,
  Card,
  ConfirmationCard,
  Disclosure,
  ListRow,
  MuscleMap,
  Notice,
  Sheet,
  Stack,
} from '../../../shared/ui';
import { useWorkoutResource } from '../../workouts/data/WorkoutDataProvider';
import { injurySpec } from '../../workouts/data/models';
import { InjuryEditor, type InjuryRecord } from '../../workouts/components/InjuryEditor';
import { ResourceStatus } from '../../workouts/components/ResourceStatus';
import { useWorkoutAction } from '../../workouts/data/useWorkoutAction';
import { useHealthData } from '../data/HealthDataProvider';
import { recoverySpec } from '../data/models';
import { TrainingSyncNotice } from '../../workouts/components/TrainingSyncNotice';
import { useTheme } from '../../../shared/theme/ThemeProvider';

export function MuscleStatusCard() {
  const { theme } = useTheme();
  const injuries = useWorkoutResource(injurySpec);
  const recovery = useWorkoutResource(recoverySpec);
  const { today } = useHealthData();
  const [editing, setEditing] = useState<InjuryRecord | 'new' | null>(null);
  const [remove, setRemove] = useState(false);
  const action = useWorkoutAction();
  const active = injuries.data?.filter((injury) => !injury.resolvedDate) ?? [];
  const resolved = injuries.data?.filter((injury) => injury.resolvedDate) ?? [];
  const assignments = [
    ...(recovery.data?.muscles ?? [])
      .filter(
        (row) =>
          !active.some(
            (injury) => injury.muscleName.toLowerCase() === row.muscle.toLowerCase(),
          ),
      )
      .map((row) => ({
        muscle: row.muscle,
        role:
          row.hoursAgo !== null && row.hoursAgo < 48
            ? ('secondary' as const)
            : ('main' as const),
      })),
    ...active.map((injury) => ({ muscle: injury.muscleName, role: 'injured' as const })),
  ];
  async function change(deleted = false) {
    if (!editing || editing === 'new') {
      return;
    }
    await action.run(async () => {
      if (!injuries.resources) {
        throw new Error('Sign in to update this injury.');
      }
      await injuries.resources.changes.changeInjury(editing.id, deleted ? undefined : today);
      setEditing(null);
      setRemove(false);
    });
  }
  return (
    <>
      <Card>
        <Stack direction="row" align="center" justify="space-between">
          <AppText variant="eyebrow" tone="muted">
            Muscle Status
          </AppText>
          <ResourceStatus
            inline
            label="Muscle status"
            state={{
              ...injuries,
              loading: injuries.loading || recovery.loading,
              refreshing: injuries.refreshing || recovery.refreshing,
              error: injuries.error ?? recovery.error,
            }}
            refresh={() => {
              injuries.refresh();
              recovery.refresh();
            }}
          />
          <AppButton
            title="+ Add injury"
            variant="ghost"
            onPress={() => {
              setEditing('new');
              setRemove(false);
            }}
          />
        </Stack>
        {!!assignments.length && (
          <>
            <Stack direction="row" wrap>
              <Legend
                items={[
                  { label: 'Recovered', color: theme.anatomy.main },
                  { label: 'Recovering', color: theme.anatomy.secondary },
                  { label: 'Injured', color: theme.anatomy.injured },
                ]}
              />
            </Stack>
            <MuscleMap assignments={assignments} />
          </>
        )}
        {injuries.data && !active.length && (
          <AppText variant="caption" tone="muted">
            No active injuries
          </AppText>
        )}
        {active.map((injury) => (
          <ListRow
            key={injury.id}
            title={injury.muscleName}
            subtitle={`${injury.severity} · Day ${daysBetweenDateStrs(injury.startedDate, today) + 1}${injury.notes ? ` · ${injury.notes}` : ''}`}
            onPress={() => {
              setEditing(injury);
              setRemove(false);
            }}
          />
        ))}
        {!!resolved.length && (
          <Disclosure title={`Resolved (${resolved.length})`}>
            {resolved.map((injury) => (
              <AppText key={injury.id} variant="caption" tone="muted">
                {injury.muscleName} · Resolved {injury.resolvedDate}
              </AppText>
            ))}
          </Disclosure>
        )}
        <TrainingSyncNotice />
      </Card>
      <Sheet
        visible={editing !== null}
        title={editing === 'new' ? 'Record Injury' : 'Edit Injury'}
        onClose={() => setEditing(null)}
      >
        {editing && (
          <InjuryEditor
            stable
            key={editing === 'new' ? 'new' : editing.id}
            injury={editing === 'new' ? undefined : editing}
            onSaved={() => setEditing(null)}
          />
        )}
        {action.error && <Notice title="Injury record" message={action.error} error />}
        {editing && editing !== 'new' && !remove && (
          <Stack direction="row">
            <AppButton
              title="Mark resolved"
              variant="surface"
              busy={action.busy}
              onPress={() => {
                void change();
              }}
            />
            <AppButton title="Delete" variant="danger" onPress={() => setRemove(true)} />
          </Stack>
        )}
        {remove && (
          <ConfirmationCard
            title="Delete injury?"
            message="Remove this recorded injury from your account."
            confirmLabel="Delete"
            cancelLabel="Cancel"
            danger
            busy={action.busy}
            onConfirm={() => {
              void change(true);
            }}
            onCancel={() => setRemove(false)}
          />
        )}
      </Sheet>
    </>
  );
}
