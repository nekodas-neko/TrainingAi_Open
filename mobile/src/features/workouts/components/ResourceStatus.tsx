import { Badge, Notice, StateCard, StatusIndicator } from '../../../shared/ui';
import type { ResourceState } from '../data/WorkoutResources';
import { statusVisible } from '../../health/data/status-visible';

export function ResourceStatus({
  state,
  refresh,
  quiet = false,
  inline = false,
  whenActive = false,
  label = 'Data',
}: {
  state: ResourceState & { connected?: boolean };
  refresh: () => void;
  quiet?: boolean;
  inline?: boolean;
  /** Inline only: draw nothing, and keep the 48 px slot out of the row, until the view is loading,
   *  refreshing or has failed. The current app's card headers have no such slot. */
  whenActive?: boolean;
  label?: string;
}) {
  if (inline) {
    if (whenActive && !statusVisible(state)) {
      return null;
    }
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
