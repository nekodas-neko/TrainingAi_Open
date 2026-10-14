import { plural } from '@trainingai/shared/format/plural';
import { useState } from 'react';
import appConfig from '../../../../app.json';
import {
  AppButton,
  AppText,
  Card,
  PageLayout,
  Stack,
  TabPanel,
  Sheet,
  StatusIndicator,
} from '../../../shared/ui';
import { FeedbackSheet } from '../components/FeedbackSheet';
import { DeleteAccountSheet } from '../components/DeleteAccountSheet';
import { useAccountContext } from '../../account/AccountProvider';
import { useNativeDataActions } from '../data/useNativeDataActions';
import { useTheme } from '../../../shared/theme/ThemeProvider';
import { AppHandoffDebugCard } from '../../health/components/AppHandoffDebugCard';
export function AboutScreen({ onBack }: { onBack: () => void }) {
  const { theme } = useTheme(),
    account = useAccountContext(),
    actions = useNativeDataActions();
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
      {modal === 'signout' && (
        <Sheet
          visible
          title="Sign out"
          onClose={() => setModal(null)}
          actions={
            <StatusIndicator label="Saved changes" busy={actions.busy} error={actions.error} />
          }
        >
          <AppText>
            {actions.pending
              ? `${plural(actions.pending, 'change', 'changes')} ${actions.pending === 1 ? 'is' : 'are'} waiting to upload. They stay on this phone and can sync when you sign back into this account.`
              : 'Your saved account data stays on this phone.'}
          </AppText>
          {actions.pending > 0 && (
            <AppButton
              title="Sync now"
              busy={actions.busy}
              onPress={() => void actions.sync()}
            />
          )}
          <AppButton
            title="Sign out"
            disabled={actions.busy}
            onPress={() => {
              void account.signOut();
              setModal(null);
            }}
          />
        </Sheet>
      )}
    </PageLayout>
  );
}
