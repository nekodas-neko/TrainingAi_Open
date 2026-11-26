import {
  AppText,
  Notice,
  IconTileGrid,
  StableContent,
  StatusIndicator,
} from '../../../shared/ui';
import { useWorkoutResource } from '../../workouts/data/WorkoutDataProvider';
import { activityIcon, activityTypesSpec, type ActivityType } from '../data/models';
/** The activity-type tiles and what goes with them; `filter` drops types that have a place elsewhere. Only the Start sheet shows them (#4100). */
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
