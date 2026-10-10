import { ActivityIndicator, Button, Switch, Text, View } from 'react-native';
import { useHealthContext } from '../HealthProvider';
import { useReportsContext } from '../../../development/diagnostics/ReportsProvider';
import type { AppStyles } from '../../../shared/theme/useAppTheme';
import { isRunningInExpoGo } from 'expo';
import { Platform } from 'react-native';
import { diagnosticsAvailable } from '../../../development/diagnostics/client';

export function DataScreen({ styles: s }: { styles: AppStyles }) {
  const health = useHealthContext();
  const reports = useReportsContext();
  const { snapshot, busy, error } = health;
  const { report, reportBusy, reportStatus, reportAutomatically, setReportAutomatically } = reports;
  const healthPreviewOnly = Platform.OS !== 'ios' || isRunningInExpoGo();
  function connect() {
    reports.setReportStatus(null);
    return health.connect(
      reportAutomatically && diagnosticsAvailable
        ? (readings, failure) => report(readings, 'Data', failure)
        : undefined,
    );
  }
  return (
    <>
      <View style={s.card}>
        <Text style={s.heading}>Read Apple Health</Text>
        {healthPreviewOnly ? (
          <Text style={s.muted}>
            Apple Health needs a separate iPhone development build. This preview supports sample
            data only.
          </Text>
        ) : busy ? (
          <ActivityIndicator accessibilityLabel="Reading Apple Health" />
        ) : (
          <Button
            title={snapshot?.mode === 'device' ? 'Refresh Apple Health' : 'Connect Apple Health'}
            disabled={reportBusy}
            onPress={connect}
          />
        )}
      </View>
      {diagnosticsAvailable && (
        <View style={s.card}>
          <Text style={s.heading}>Development feedback</Text>
          <Text style={s.muted}>
            Send the displayed health values, record counts, sources, timestamps and query errors to
            your PC. The report stays in a local development file.
          </Text>
          <Button
            title={reportBusy ? 'Sending report…' : 'Send report to PC'}
            disabled={reportBusy || busy || (!snapshot && !error)}
            onPress={() => {
              void report(snapshot, 'Data', error);
            }}
          />
          <View style={s.row}>
            <Text style={s.label}>Send after each refresh</Text>
            <Switch
              value={reportAutomatically}
              disabled={reportBusy || busy}
              onValueChange={setReportAutomatically}
            />
          </View>
          <Text style={s.small}>Off by default. Resets when the app reloads.</Text>
          {reportStatus && (
            <Text accessibilityRole="alert" style={s.muted}>
              {reportStatus}
            </Text>
          )}
        </View>
      )}
      {snapshot?.inspection ? (
        <>
          <View style={s.card}>
            <Text style={s.heading}>Readable records · last 7 days</Text>
            <Text style={s.muted}>
              {new Date(snapshot.inspection.startAt).toLocaleString()} –{' '}
              {new Date(snapshot.inspection.endAt).toLocaleString()}
            </Text>
            <Text style={s.muted}>
              Latest samples, not daily totals. Each type returns up to 2,000 records; counts and
              sources can be incomplete at the limit.
            </Text>
            <Text style={s.muted}>
              No readable records can mean no data in this period or read permission is off. Workout
              routes are not inspected.
            </Text>
          </View>
          {snapshot.inspection.entries.map((entry) => (
            <View key={entry.key} style={s.card}>
              <View style={s.row}>
                <Text style={s.label}>{entry.label}</Text>
                <Text style={s.value}>
                  {entry.status === 'records'
                    ? `${entry.limited ? 'At least ' : ''}${entry.count?.toLocaleString()} records`
                    : entry.status === 'empty'
                      ? 'No readable records'
                      : entry.status === 'unsupported'
                        ? 'Not supported on this iPhone'
                        : 'Could not read'}
                </Text>
              </View>
              {entry.latestValue && <Text style={s.heading}>Latest: {entry.latestValue}</Text>}
              {entry.latestStart && (
                <Text style={s.muted}>
                  {new Date(entry.latestStart).toLocaleString()} –{' '}
                  {new Date(entry.latestEnd!).toLocaleString()}
                </Text>
              )}
              {entry.detail && <Text style={s.muted}>{entry.detail}</Text>}
              {entry.sources.map((source) => (
                <View key={source.bundleIdentifier}>
                  <Text style={s.small}>
                    {source.name} · {source.count.toLocaleString()} returned records
                  </Text>
                  <Text style={s.small}>Latest: {new Date(source.latestAt).toLocaleString()}</Text>
                </View>
              ))}
            </View>
          ))}
        </>
      ) : (
        <View style={s.card}>
          <Text style={s.heading}>No inspection loaded</Text>
          <Text style={s.muted}>
            Use the Apple Health button above to check data types, sources and timestamps. Sample
            data does not include this inspection.
          </Text>
        </View>
      )}
    </>
  );
}
