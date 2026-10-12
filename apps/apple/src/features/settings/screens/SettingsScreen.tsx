import { AppearancePanel } from '../components/AppearancePanel';
import { AppText, AppButton, Card } from '../../../shared/ui';
import { useAccountContext } from '../../account/AccountProvider';
import { useReportsContext } from '../../../development/diagnostics/ReportsProvider';
import { diagnosticsAvailable } from '../../../development/diagnostics/client';
import { AccountPanel } from '../../account/components/AccountPanel';
import { useState } from 'react';
import { HomeLayoutSheet } from '../../home/components/HomeLayoutSheet';
import { FeatureRow } from '../../../shared/ui';

export function SettingsScreen() {
  const account = useAccountContext();
  const reports = useReportsContext();
  const { report, reportBusy, reportStatus } = reports;
  const [layout, setLayout] = useState(false);
  return (
    <>
      <AppearancePanel />
      <Card>
        <AppText variant="heading">Home layout</AppText>
        <AppButton
          title="Widgets, metric tiles & score appearance"
          variant="ghost"
          onPress={() => setLayout(true)}
        />
      </Card>
      <Card>
        <AppText variant="heading">Preferences</AppText>
        <FeatureRow
          title="Day & week review reminders"
          subtitle="Notification scheduling is deferred"
        />
        <FeatureRow
          title="Health anomaly alerts"
          subtitle="Notification scheduling is deferred"
        />
        <FeatureRow title="Google Calendar sync" subtitle="Calendar integration is deferred" />
        <FeatureRow
          title="Rest timer & run/walk status"
          subtitle="Platform integrations are deferred"
        />
      </Card>
      <AccountPanel />
      {diagnosticsAvailable && (
        <Card>
          <AppText variant="heading">Sign-in feedback</AppText>
          <AppText tone="muted">
            Send sign-in progress to your PC. No passwords, tokens or health readings are
            included.
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
      {layout && <HomeLayoutSheet onClose={() => setLayout(false)} />}
    </>
  );
}
