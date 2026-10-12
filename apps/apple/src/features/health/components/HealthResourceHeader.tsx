import { AppText, Stack } from '../../../shared/ui';
import { ResourceStatus } from '../../workouts/components/ResourceStatus';
import type { ResourceState } from '../../workouts/data/WorkoutResources';

export function HealthResourceHeader({
  title,
  state,
  refresh,
}: {
  title: string;
  state: ResourceState & { connected?: boolean };
  refresh: () => void;
}) {
  return (
    <Stack direction="row" justify="space-between" align="center">
      <AppText variant="eyebrow" tone="muted" style={{ flex: 1 }}>
        {title}
      </AppText>
      <ResourceStatus inline label={title} state={state} refresh={refresh} />
    </Stack>
  );
}
