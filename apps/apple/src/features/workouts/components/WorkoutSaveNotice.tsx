import { AppButton, Notice } from '../../../shared/ui';
import { useWorkoutJournal } from '../logging/WorkoutJournalProvider';

export function WorkoutSaveNotice() {
  const journal = useWorkoutJournal();
  return (
    <>
      {journal.message && (
        <Notice
          title={journal.saveStatus === 'error' ? 'Save needs attention' : 'Workout'}
          message={journal.message}
          error={journal.saveStatus === 'error'}
        />
      )}
      {journal.saveStatus === 'error' && (
        <AppButton
          title="Retry saving"
          variant="secondary"
          onPress={() => {
            void journal.controller?.retrySave();
          }}
        />
      )}
    </>
  );
}
