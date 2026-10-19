import { plural } from '@trainingai/shared/format/plural';
import { useState } from 'react';
import {
  AppButton,
  AppText,
  Card,
  ConfirmationCard,
  PageLayout,
  Picker,
  ProgressBar,
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
import { todayInTz } from '@trainingai/shared/date-utils';
import { HISTORY_DOWNLOAD_DAYS } from '../data/history-domains';
import { useHistoryDownload } from '../data/HistoryDownloadProvider';
// The shortest "how far back" choice is the current app's 30-day import window
// (`HISTORY_WINDOW_DAYS` in `lib/health-connect-history-import.ts`).
const HISTORY_WINDOW_DAYS = 30;
export function DataSyncScreen({ onBack }: { onBack: () => void }) {
  const actions = useNativeDataActions(),
    account = useAccountContext(),
    health = useAppleImport(),
    history = useHistoryDownload(),
    { theme } = useTheme();
  const [restore, setRestore] = useState(false),
    [days, setDays] = useState('30'),
    [range, setRange] = useState('90'),
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
          busy={busy || actions.busy || health.busy || history.status === 'running'}
          error={error ?? actions.error ?? health.error ?? history.error}
          message={actions.message}
        />
      }
    >
      <TabPanel>
        <Stack style={{ paddingHorizontal: theme.spacing.lg }}>
          <Card>
            <AppText variant="subheading">Sync now</AppText>
            <AppText variant="caption" tone="muted">
              Pull latest data from server
            </AppText>
            <AppText>
              {actions.pending
                ? `${plural(actions.pending, 'change', 'changes')} waiting to upload`
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
            <AppText variant="subheading">Restore from cloud</AppText>
            <AppText variant="caption" tone="muted">
              Saves your history to this phone so it opens offline. Your unsent changes and
              unfinished workouts are kept.
            </AppText>
            <Picker
              label="How far back to restore"
              value={range}
              options={HISTORY_DOWNLOAD_DAYS.map((days) => ({
                value: String(days),
                label: days === 365 ? '1 year' : `${days} days`,
              }))}
              onChange={setRange}
            />
            {history.plan && history.status !== 'idle' && (
              <>
                <ProgressBar
                  value={history.total ? history.done / history.total : 0}
                  complete={history.status === 'complete'}
                />
                <AppText variant="caption" tone="muted">
                  {history.status === 'complete'
                    ? `${history.plan.days} days saved for offline use`
                    : `${history.done} of ${history.total} saved${
                        history.status === 'paused' ? ' · Paused' : ''
                      }`}
                </AppText>
              </>
            )}
            {history.status === 'running' ? (
              <AppButton
                title="Cancel"
                variant="secondary"
                onPress={() => void history.download?.cancel()}
              />
            ) : history.status === 'paused' || history.status === 'failed' ? (
              <AppButton
                title="Resume"
                disabled={!history.download}
                onPress={() => void history.download?.resume()}
              />
            ) : (
              <AppButton
                title="Restore from cloud"
                variant="secondary"
                disabled={!account.dataReader || !history.download || actions.busy || busy}
                onPress={() => setRestore(true)}
              />
            )}
          </Card>
          {restore && (
            <ConfirmationCard
              title="Restore saved records?"
              message="Your local changes are kept. The app will upload what it can, then save your history to this phone."
              confirmLabel="Restore"
              cancelLabel="Cancel"
              onCancel={() => setRestore(false)}
              onConfirm={() => {
                setRestore(false);
                void actions.sync(true).then(() =>
                  history.download?.start({
                    anchor: todayInTz(
                      account.dataReader?.timezone ??
                        Intl.DateTimeFormat().resolvedOptions().timeZone,
                    ),
                    days: Number(range),
                  }),
                );
              }}
            />
          )}
          <Card>
            <AppText variant="subheading">Import more history</AppText>
            <AppText variant="caption" tone="muted">
              Pull older {deviceHealthName} data. Choose how far back to read
            </AppText>
            <Picker
              label="How far back to read"
              value={days}
              options={[
                { value: '30', label: `${HISTORY_WINDOW_DAYS} days` },
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
            <AppText variant="subheading">Export my data</AppText>
            <AppText variant="caption" tone="muted">
              Download everything as a single file, and choose where to save it.
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
