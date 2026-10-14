import { useState } from 'react';
import appConfig from '../../../../app.json';
import {
  AppButton,
  AppText,
  Card,
  PageLayout,
  Stack,
  TabPanel,
} from '../../../shared/ui';
import { FeedbackSheet } from '../components/FeedbackSheet';
import { DeleteAccountSheet } from '../components/DeleteAccountSheet';
import { SignOutSheet } from '../components/SignOutSheet';
import { useAccountContext } from '../../account/AccountProvider';
import { useTheme } from '../../../shared/theme/ThemeProvider';
import { AppHandoffDebugCard } from '../../health/components/AppHandoffDebugCard';
export function AboutScreen({ onBack }: { onBack: () => void }) {
  const { theme } = useTheme(),
    account = useAccountContext();
  const [modal, setModal] = useState<'feedback' | 'delete' | 'signout' | null>(null);
  return (
    <PageLayout title="About" onBack={onBack}>
      <TabPanel>
        <Stack style={{ paddingHorizontal: theme.spacing.lg }}>
          <Card>
            <AppText variant="hero">TrainingAi</AppText>
            <AppText>Version {appConfig.expo.version}</AppText>
            <AppText variant="caption" tone="muted">
              Your training, nutrition and health in one place.
            </AppText>
          </Card>
          <Card>
            <AppText variant="heading">Feedback</AppText>
            <AppButton
              title="Report a bug, request a feature or ask a question"
              variant="ghost"
              onPress={() => setModal('feedback')}
            />
          </Card>
          <AppHandoffDebugCard />
          <Card>
            <AppText variant="heading">Account</AppText>
            <AppButton
              title="Sign out"
              variant="secondary"
              disabled={!account.state.hasSession}
              onPress={() => setModal('signout')}
            />
            <AppButton
              title="Delete account"
              variant="danger"
              disabled={!account.dataReader}
              onPress={() => setModal('delete')}
            />
          </Card>
        </Stack>
      </TabPanel>
      {modal === 'feedback' && <FeedbackSheet onClose={() => setModal(null)} />}
      {modal === 'delete' && <DeleteAccountSheet onClose={() => setModal(null)} />}
      {modal === 'signout' && <SignOutSheet onClose={() => setModal(null)} />}
    </PageLayout>
  );
}
