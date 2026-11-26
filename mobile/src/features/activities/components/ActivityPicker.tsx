import {
  AppText,
  Notice,
  IconTileGrid,
  Sheet,
  StableContent,
  StatusIndicator,
} from '../../../shared/ui';
import { useWorkoutResource } from '../../workouts/data/WorkoutDataProvider';
import { activityIcon, activityTypesSpec, type ActivityType } from '../data/models';
/** The activity-type tiles and what goes with them; `exclude` drops types that have a place elsewhere. */
export function ActivityTypeTiles({
  visible,
  onSelect,
  busy = false,
  error = null,
  filter,
}: {
  visible: boolean;
  onSelect: (type: ActivityType) => void;
  busy?: boolean;
  error?: string | null;
  filter?: (types: readonly ActivityType[]) => ActivityType[];
}) {
  const state = useWorkoutResource(activityTypesSpec, visible);
  const types = filter
    ? filter(state.data?.activityTypes ?? [])
    : (state.data?.activityTypes ?? []);
  return (
    <>
      {error && <Notice error title="Could not start the activity" message={error} />}
      <StatusIndicator
        label="Activity types"
        busy={state.loading || busy}
        error={state.error}
        onRetry={state.refresh}
      />
      <StableContent minHeight={220} loading={state.loading && !state.data}>
        <IconTileGrid
          disabled={busy}
          options={types.map((type) => ({ ...type, icon: activityIcon(type.icon) }))}
          onSelect={(id) => {
            const type = types.find((item) => item.id === id);
            if (type) {
              onSelect(type);
            }
          }}
        />
        {state.data && !types.length && (
          <AppText tone="muted">No activity types available.</AppText>
        )}
        {!state.connected && <AppText tone="muted">Sign in to log an activity.</AppText>}
      </StableContent>
    </>
  );
}

export function ActivityPicker({
  visible,
  onClose,
  onDismiss,
  onSelect,
  busy = false,
  error = null,
}: {
  visible: boolean;
  onClose: () => void;
  /** The sheet has finished closing. */
  onDismiss?: () => void;
  onSelect: (type: ActivityType) => void;
  busy?: boolean;
  /** Why starting the chosen activity failed, shown where it was tapped. */
  error?: string | null;
}) {
  return (
    <Sheet visible={visible} title="Log Activity" onClose={onClose} onDismiss={onDismiss}>
      <ActivityTypeTiles visible={visible} onSelect={onSelect} busy={busy} error={error} />
    </Sheet>
  );
}
