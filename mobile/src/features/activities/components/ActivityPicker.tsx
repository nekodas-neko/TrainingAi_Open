import {
  AppText,
  IconTileGrid,
  Sheet,
  StableContent,
  StatusIndicator,
} from '../../../shared/ui';
import { useWorkoutResource } from '../../workouts/data/WorkoutDataProvider';
import { activityIcon, activityTypesSpec, type ActivityType } from '../data/models';
export function ActivityPicker({
  visible,
  onClose,
  onSelect,
  busy = false,
}: {
  visible: boolean;
  onClose: () => void;
  onSelect: (type: ActivityType) => void;
  busy?: boolean;
}) {
  const state = useWorkoutResource(activityTypesSpec, visible);
  return (
    <Sheet visible={visible} title="Log Activity" onClose={onClose}>
      <StatusIndicator
        label="Activity types"
        busy={state.loading || busy}
        error={state.error}
        onRetry={state.refresh}
      />
      <StableContent minHeight={220} loading={state.loading && !state.data}>
        <IconTileGrid
          disabled={busy}
          options={(state.data?.activityTypes ?? []).map((type) => ({
            ...type,
            icon: activityIcon(type.icon),
          }))}
          onSelect={(id) => {
            const type = state.data?.activityTypes.find((item) => item.id === id);
            if (type) {
              onSelect(type);
            }
          }}
        />
        {state.data && !state.data.activityTypes.length && (
          <AppText tone="muted">No activity types available.</AppText>
        )}
        {!state.connected && <AppText tone="muted">Sign in to log an activity.</AppText>}
      </StableContent>
    </Sheet>
  );
}
