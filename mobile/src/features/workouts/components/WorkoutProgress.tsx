import { AppButton, AppText, Card, ListRow, Section, StateCard } from '../../../shared/ui';
import { useWorkoutJournal } from '../logging/WorkoutJournalProvider';
import { recordedSets } from '../logging/workout';

export function WorkoutProgress({ openWorkout }: { openWorkout: (id: string) => void }) {
  const journal = useWorkoutJournal();
  if (!journal.controller) {
    return null;
  }
  if (!journal.ready) {
    return journal.message ? (
      <StateCard
        title="Saved workouts unavailable"
        message={journal.message}
        action="Retry loading"
        onAction={() => {
          void journal.controller?.initialize();
        }}
        loading={journal.busy}
      />
    ) : null;
  }
  const active = journal.data.workouts.find((workout) => workout.status === 'active');
  const completed = journal.data.workouts
    .filter((workout) => workout.status === 'completed')
    .slice(-3)
    .reverse();
  return (
    <>
      {active && (
        <Card tone="brand">
          <AppText variant="eyebrow" tone="brand">
            WORKOUT IN PROGRESS
          </AppText>
          <AppText variant="heading">{active.sessionName}</AppText>
          <AppText tone="muted">
            {recordedSets(active).length} {recordedSets(active).length === 1 ? 'set' : 'sets'}{' '}
            recorded on this phone
          </AppText>
          <AppButton title="Resume workout" onPress={() => openWorkout(active.id)} />
        </Card>
      )}
      {completed.length > 0 && (
        <Section title="Recent workouts on this phone">
          {completed.map((workout) => (
            <ListRow
              key={workout.id}
              title={workout.sessionName}
              subtitle={`${workout.date} · ${recordedSets(workout).length} sets · ${workout.pending.length ? 'Upload pending' : 'Uploaded'}`}
              onPress={() => openWorkout(workout.id)}
            />
          ))}
        </Section>
      )}
    </>
  );
}
