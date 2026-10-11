import { AppButton, Notice, Stack } from '../../../shared/ui';
import { useTrainingSync } from '../data/WorkoutDataProvider';

export function TrainingSyncNotice({ programsOnly = false }: { programsOnly?: boolean }) {
  const sync = useTrainingSync();
  const pending = sync.operations.filter(
    (operation) => !programsOnly || operation.kind.startsWith('program_'),
  );
  if (!sync.store || (!pending.length && !sync.error)) {
    return null;
  }
  return (
    <Stack>
      <Notice
        title={pending.length ? 'Changes saved on phone' : 'Training sync unavailable'}
        message={
          sync.error ??
          `${pending.length} change${pending.length === 1 ? '' : 's'} ${sync.syncing ? 'uploading…' : 'waiting to upload. Program sessions update after upload.'}`
        }
      />
      <AppButton
        title={sync.ready ? 'Retry upload' : 'Retry opening saved changes'}
        variant="ghost"
        busy={sync.syncing}
        onPress={() => {
          void sync.store
            ?.initialize()
            .then(() => sync.store?.sync())
            .catch(() => {});
        }}
      />
    </Stack>
  );
}
