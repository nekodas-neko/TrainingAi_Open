import { useState } from 'react';
import {
  AppButton,
  AppText,
  Card,
  ConfirmationCard,
  PageLayout,
  Picker,
  Stack,
  StatusIndicator,
  TabPanel,
} from '../../../shared/ui';
import { useNativeDataActions } from '../data/useNativeDataActions';
import { useAccountContext } from '../../account/AccountProvider';
import { useAppleImport } from '../../health/HealthProvider';
import { shareAccountExport } from '../../../integrations/sharing/account-export';
import { useTheme } from '../../../shared/theme/ThemeProvider';
import { deviceHealthName } from '../../../integrations/device-health/platform';
export function DataSyncScreen({ onBack }: { onBack: () => void }) {
  const actions = useNativeDataActions(),
    account = useAccountContext(),
    health = useAppleImport(),
    { theme } = useTheme();
  const [restore, setRestore] = useState(false),
    [days, setDays] = useState('35'),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  async function exportData() {
    if (!account.dataReader) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await shareAccountExport(account.dataReader);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not export your data.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <PageLayout
      title="Data & Sync"
      onBack={onBack}
      actions={
        <StatusIndicator
          label="Data & Sync"
          busy={busy || actions.busy || health.busy}
          error={error ?? actions.error ?? health.error}
          message={actions.message}
        />
      }
    >
      <TabPanel>
        <Stack style={{ paddingHorizontal: theme.spacing.lg }}>
          <Card>
            <AppText variant="heading">Saved on this phone</AppText>
            <AppText>
              {actions.pending
                ? `${actions.pending} changes waiting to upload`
                : 'No changes waiting to upload'}
            </AppText>
            <AppButton
              title="Sync now"
              busy={actions.busy}
              disabled={!account.dataReader || busy}
              onPress={() => void actions.sync()}
            />
          </Card>
          <Card>
            <AppText variant="heading">Restore from cloud</AppText>
            <AppText variant="caption" tone="muted">
              Refresh saved account records without removing unfinished workouts or pending
              edits. Older history loads when opened.
            </AppText>
            <AppButton
              title="Restore from cloud"
              variant="secondary"
              disabled={!account.dataReader || actions.busy || busy}
              onPress={() => setRestore(true)}
            />
          </Card>
          {restore && (
            <ConfirmationCard
              title="Restore saved records?"
              message="Your local changes are kept. The app will upload what it can and refresh your account records."
              confirmLabel="Restore"
              cancelLabel="Cancel"
              onCancel={() => setRestore(false)}
              onConfirm={() => {
                setRestore(false);
                void actions.sync(true);
              }}
            />
          )}
          <Card>
            <AppText variant="heading">Import more {deviceHealthName} history</AppText>
            <Picker
              label="History to read"
              value={days}
              options={[
                { value: '35', label: '35 days' },
                { value: '90', label: '90 days' },
                { value: '180', label: '180 days' },
              ]}
              onChange={setDays}
            />
            <AppText variant="caption" tone="muted">
              Reads permitted records and resumes across app opens. Records already imported are
              not added twice.
            </AppText>
            <AppButton
              title="Import history"
              disabled={!health.store || health.busy}
              busy={health.busy}
              onPress={() =>
                void health.store
                  ?.importHistory(new Date(Date.now() - Number(days) * 86400000).toISOString())
                  .catch((cause) =>
                    setError(
                      cause instanceof Error
                        ? cause.message
                        : 'Could not import health history.',
                    ),
                  )
              }
            />
          </Card>
          <Card>
            <AppText variant="heading">Export my data</AppText>
            <AppText variant="caption" tone="muted">
              Download your server records as a complete NDJSON file and choose where to save
              it.
            </AppText>
            <AppButton
              title="Export my data"
              busy={busy}
              disabled={!account.dataReader || actions.busy}
              onPress={() => void exportData()}
            />
          </Card>
        </Stack>
      </TabPanel>
    </PageLayout>
  );
}
