import { AppButton, AppText, Notice, Stack, StatusIndicator } from '../../../shared/ui';
import { useHealthData } from '../data/HealthDataProvider';

export function HealthSyncNotice({ inline = false }: { inline?: boolean }) {
  const health = useHealthData();
  const pending = health.operations.length + health.verdictResponses.length + health.readinessResponses.length;
  if (inline) {
    return (
      <StatusIndicator
        label="Saved health changes"
        busy={health.syncing}
        error={health.error}
        message={
          pending ? `${pending} health changes saved on phone, waiting to upload.` : null
        }
        actionLabel="Retry upload"
        onRetry={() => {
          void health.store?.sync();
        }}
      />
    );
  }
  if (health.error && !health.ready) {
    return <Notice title="Health storage" message={health.error} error />;
  }
  if (!pending) {
    return null;
  }
  return (
    <Stack>
      <AppText variant="caption" tone="muted">
        {pending} health {pending === 1 ? 'change' : 'changes'} saved on phone ·{' '}
        {health.syncing ? 'Uploading…' : 'Waiting to upload'}
      </AppText>
      {health.error && <Notice title="Health upload" message={health.error} />}
      {!health.syncing && (
        <AppButton
          title="Retry upload"
          variant="ghost"
          onPress={() => {
            void health.store?.sync();
          }}
        />
      )}
    </Stack>
  );
}
