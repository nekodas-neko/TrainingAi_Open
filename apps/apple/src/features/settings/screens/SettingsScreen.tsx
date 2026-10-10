import { AppearancePanel } from '../components/AppearancePanel';
import { AppText, AppButton, Card } from '../../../shared/ui';
import { useAccountContext } from '../../account/AccountProvider';
import { useHealthContext } from '../../health/HealthProvider';
import { useReportsContext } from '../../../development/diagnostics/ReportsProvider';
import { diagnosticsAvailable } from '../../../development/diagnostics/client';
import { AccountPanel } from '../../account/components/AccountPanel';

export function SettingsScreen() {
  const account = useAccountContext();
  const health = useHealthContext();
  const reports = useReportsContext();
  const { busy } = health;
  const { report, reportBusy, reportStatus } = reports;
  return (
    <>
      <AppearancePanel />
      <Card>
        <AppText variant="heading">Apple Health</AppText>
        <AppText tone="muted">
          Read access only. An empty result can mean no data or no read permission; Apple does not
          reveal which.
        </AppText>
      </Card>
      <AccountPanel />
      {diagnosticsAvailable && (
        <Card>
          <AppText variant="heading">Sign-in feedback</AppText>
          <AppText tone="muted">
            Send sign-in progress to your PC. No passwords, tokens or health readings are included.
          </AppText>
          <AppButton
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
            <AppText accessibilityRole="alert" tone="muted">
              {reportStatus}
            </AppText>
          )}
        </Card>
      )}
      <AppButton
        title="Clear loaded readings"
        variant="secondary"
        disabled={busy}
        onPress={() => {
          health.clear();
        }}
      />
    </>
  );
}
