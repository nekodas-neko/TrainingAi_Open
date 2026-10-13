import {
  deviceHealthName,
  deviceHealthAvailable,
  openDeviceHealthSettings,
} from '../../../integrations/device-health/platform';
import { Platform } from 'react-native';
import {
  AppText,
  AppButton,
  Card,
  Stack,
  SwitchRow,
  StatusIndicator,
} from '../../../shared/ui';
import { useHealthContext, useAppleImport } from '../HealthProvider';
import { useReportsContext } from '../../../development/diagnostics/ReportsProvider';
import { diagnosticsAvailable } from '../../../development/diagnostics/client';
import { useAccountContext } from '../../account/AccountProvider';
import { useNutrition } from '../../nutrition/data/NutritionProvider';

export function DataScreen() {
  const health = useHealthContext();
  const imported = useAppleImport();
  const reports = useReportsContext();
  const account = useAccountContext();
  const nutrition = useNutrition();
  const { snapshot, busy, error } = health;
  const { report, reportBusy, reportStatus, reportAutomatically, setReportAutomatically } =
    reports;
  const healthPreviewOnly = !deviceHealthAvailable();
  function sendReport(readings = snapshot, failure = error) {
    return report(readings, 'Data', failure, account.diagnostics() ?? undefined, {
      nutrition: nutrition.store?.diagnostics ?? null,
      healthImport: {
        enabled: imported.enabled,
        busy: imported.busy,
        pending: imported.store?.getSnapshot().pending ?? imported.pending,
        error: imported.store?.getSnapshot().error ?? imported.error,
        completedAt: imported.completed?.completedAt ?? null,
        heartRate: imported.completed?.heartRate ?? null,
      },
    });
  }
  function connect() {
    reports.setReportStatus(null);
    return health.connect(
      reportAutomatically && diagnosticsAvailable
        ? (readings, failure) => sendReport(readings, failure)
        : undefined,
    );
  }
  return (
    <>
      <Card>
        <AppText variant="heading">Read {deviceHealthName}</AppText>
        {healthPreviewOnly ? (
          <AppText tone="muted">
            {deviceHealthName} needs a signed native build. This preview supports sample data
            only.
          </AppText>
        ) : (
          <AppButton
            title={
              snapshot?.mode === 'device' || imported.enabled
                ? `Refresh ${deviceHealthName}`
                : imported.store
                  ? `Connect & sync ${deviceHealthName}`
                  : `Connect ${deviceHealthName}`
            }
            disabled={reportBusy}
            busy={busy}
            onPress={connect}
          />
        )}
      </Card>
      {Platform.OS === 'android' && deviceHealthAvailable() && (
        <AppButton
          title="Manage Health Connect permissions"
          variant="secondary"
          onPress={() => {
            void openDeviceHealthSettings().catch(() =>
              reports.setReportStatus(
                'Open Health Connect in Android Settings to manage permissions.',
              ),
            );
          }}
        />
      )}
      <Card>
        <Stack direction="row" align="center" justify="space-between">
          <AppText variant="heading">Sync to your account</AppText>
          <StatusIndicator
            label={`${deviceHealthName} sync`}
            busy={imported.busy}
            error={imported.error}
            onRetry={() => void imported.refresh()}
          />
        </Stack>
        <SwitchRow
          label={`Sync ${deviceHealthName}`}
          value={imported.enabled}
          disabled={!imported.store || imported.busy}
          onValueChange={(value) => void imported.store?.setEnabled(value).catch(() => {})}
        />
        <AppText variant="caption" tone="muted">
          Sync sends permitted health readings to your TrainingAi account for dashboard
          calculations.
        </AppText>
        <AppText variant="caption" tone="muted">
          {imported.completed
            ? `Last synced ${new Date(imported.completed.completedAt).toLocaleString()} · ${imported.completed.nights} sleep nights`
            : imported.store
              ? 'Readings are saved before upload. Your dashboard updates after they sync.'
              : 'Sign in to sync your health readings.'}
        </AppText>
        {imported.completed?.hrv && (
          <AppText variant="caption">
            HRV · {imported.completed.hrv.method}: {imported.completed.hrv.value.toFixed(1)} ms
            · {imported.completed.hrv.source}
          </AppText>
        )}
      </Card>
      {diagnosticsAvailable && (
        <Card>
          <Stack direction="row" align="center" justify="space-between">
            <AppText variant="heading" style={{ flex: 1 }}>
              Development feedback
            </AppText>
            <StatusIndicator label="Report status" busy={reportBusy} message={reportStatus} />
          </Stack>
          <AppText tone="muted">
            Send the displayed health values, record counts, sources, timestamps and query
            errors to your PC. The report stays in a local development file.
          </AppText>
          <AppButton
            title="Send report to PC"
            busy={reportBusy}
            disabled={reportBusy || busy || (!snapshot && !error)}
            onPress={() => {
              void sendReport();
            }}
          />
          <SwitchRow
            label="Send after each refresh"
            value={reportAutomatically}
            disabled={reportBusy || busy}
            onValueChange={setReportAutomatically}
          />
          <AppText variant="caption" tone="muted">
            Off by default. Resets when the app reloads.
          </AppText>
        </Card>
      )}
      {snapshot?.inspection ? (
        <>
          <Card>
            <AppText variant="heading">Readable records · last 7 days</AppText>
            <AppText tone="muted">
              {new Date(snapshot.inspection.startAt).toLocaleString()} –{' '}
              {new Date(snapshot.inspection.endAt).toLocaleString()}
            </AppText>
            <AppText tone="muted">
              Latest samples, not daily totals. Each type returns up to{' '}
              {Platform.OS === 'android' ? '100' : '2,000'} records; counts and sources can be
              incomplete at the limit.
            </AppText>
            <AppText tone="muted">
              No readable records can mean no data in this period or read permission is off.
              Workout routes are not inspected.
            </AppText>
          </Card>
          {snapshot.inspection.entries.map((entry) => (
            <Card key={entry.key}>
              <Stack direction="row" align="center" justify="space-between" wrap>
                <AppText variant="label">{entry.label}</AppText>
                <AppText variant="heading">
                  {entry.status === 'records'
                    ? `${entry.limited ? 'At least ' : ''}${entry.count?.toLocaleString()} records`
                    : entry.status === 'empty'
                      ? 'No readable records'
                      : entry.status === 'unsupported'
                        ? 'Permission unavailable or type unsupported'
                        : 'Could not read'}
                </AppText>
              </Stack>
              {entry.latestValue && (
                <AppText variant="heading">Latest: {entry.latestValue}</AppText>
              )}
              {entry.latestStart && (
                <AppText tone="muted">
                  {new Date(entry.latestStart).toLocaleString()} –{' '}
                  {new Date(entry.latestEnd!).toLocaleString()}
                </AppText>
              )}
              {entry.detail && <AppText tone="muted">{entry.detail}</AppText>}
              {entry.sources.map((source) => (
                <Stack key={source.bundleIdentifier}>
                  <AppText variant="caption" tone="muted">
                    {source.name} · {source.count.toLocaleString()} returned records
                  </AppText>
                  <AppText variant="caption" tone="muted">
                    Latest: {new Date(source.latestAt).toLocaleString()}
                  </AppText>
                </Stack>
              ))}
            </Card>
          ))}
        </>
      ) : (
        <Card>
          <AppText variant="heading">No inspection loaded</AppText>
          <AppText tone="muted">
            Use the {deviceHealthName} button above to check data types, sources and timestamps.
            Sample data does not include this inspection.
          </AppText>
        </Card>
      )}
    </>
  );
}
