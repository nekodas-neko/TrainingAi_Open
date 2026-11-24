import { ScreenBoundary } from '../../../shared/ui';
import { useActivities } from '../data/ActivityProvider';
import { ActivityScreen } from './ActivityScreen';

// The activity screen with a way out of a session that keeps crashing it (#4099): the boundary's
// Discard ends the session through the store's own discard, after a confirm step.
export function ActivityBoundary({ onBack }: { onBack: () => void }) {
  const { store } = useActivities();
  return (
    <ScreenBoundary
      title="Activity"
      screen="activity-recording"
      onBack={onBack}
      onDiscard={store ? () => store.discard() : undefined}
    >
      <ActivityScreen onBack={onBack} onSaved={onBack} />
    </ScreenBoundary>
  );
}
