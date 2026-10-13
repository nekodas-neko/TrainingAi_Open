import { Badge, Notice, StateCard, StatusIndicator } from '../../../shared/ui';
import type { ResourceState } from '../data/WorkoutResources';

export function ResourceStatus({
  state,
  refresh,
  quiet = false,
  inline = false,
  label = 'Data',
}: {
  state: ResourceState & { connected?: boolean };
  refresh: () => void;
  quiet?: boolean;
  inline?: boolean;
  label?: string;
}) {
  if (inline) {
    return (
      <StatusIndicator
        label={label}
        busy={state.connected !== false && (state.loading || state.refreshing)}
        error={state.connected === false ? 'Sign in to load this view.' : state.error}
        onRetry={state.connected === false ? undefined : refresh}
      />
    );
  }
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
      {state.saved && !quiet && <Badge label="Saved on phone" />}
      {state.error && <Notice title="Using saved data" message={state.error} />}
    </>
  );
}
