import { Button, Text, View } from 'react-native';
import { useAccountContext } from '../../account/AccountProvider';
import { useHealthContext } from '../../health/HealthProvider';
import { useReportsContext } from '../../../development/diagnostics/ReportsProvider';
import type { AppStyles } from '../../../shared/theme/useAppTheme';
import { diagnosticsAvailable } from '../../../development/diagnostics/client';
import { AccountPanel } from '../../account/components/AccountPanel';

export function SettingsScreen({ styles: s, dark }: { styles: AppStyles; dark: boolean }) {
  const account = useAccountContext();
  const health = useHealthContext();
  const reports = useReportsContext();
  const { busy } = health;
  const { report, reportBusy, reportStatus } = reports;
  return (
    <>
      <View style={s.card}>
        <Text style={s.heading}>Apple Health</Text>
        <Text style={s.muted}>
          Read access only. An empty result can mean no data or no read permission; Apple does not
          reveal which.
        </Text>
      </View>
      <AccountPanel styles={s} dark={dark} />
      {diagnosticsAvailable && (
        <View style={s.card}>
          <Text style={s.heading}>Sign-in feedback</Text>
          <Text style={s.muted}>
            Send sign-in progress to your PC. No passwords, tokens or health readings are included.
          </Text>
          <Button
            title={reportBusy ? 'Sending report…' : 'Send sign-in report to PC'}
            disabled={reportBusy}
            onPress={() => {
              const details = account.diagnostics();
              if (details) {
                void report(null, 'Settings', null, details);
              }
            }}
          />
          {reportStatus && (
            <Text accessibilityRole="alert" style={s.muted}>
              {reportStatus}
            </Text>
          )}
        </View>
      )}
      <Button
        title="Clear loaded readings"
        disabled={busy}
        onPress={() => {
          health.clear();
        }}
      />
    </>
  );
}
