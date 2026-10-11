import { Badge, Notice, StateCard } from '../../../shared/ui';
import type { ResourceState } from '../data/WorkoutResources';

export function ResourceStatus({
  state,
  refresh,
}: {
  state: ResourceState & { connected?: boolean };
  refresh: () => void;
}) {
  if (state.connected === false) {
    return <StateCard title="Connect your account" message="Sign in to load this view." />;
  }
  if (state.data === null) {
    return (
      <StateCard
        title={state.loading ? 'Loading…' : 'This view is unavailable'}
        message={state.error ?? 'Loading your saved data…'}
        loading={state.loading}
        action={state.loading ? undefined : 'Retry'}
        onAction={refresh}
      />
    );
  }
  return (
    <>
      {state.saved && <Badge label="Saved on phone" />}
      {state.error && <Notice title="Using saved data" message={state.error} />}
    </>
  );
}
