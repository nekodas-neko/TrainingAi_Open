import { useEffect, useState } from 'react';
import { Linking, Pressable } from 'react-native';
import { CHANGELOG } from '@trainingai/shared/changelog';
import { OFF_ATTRIBUTION } from '@trainingai/shared/nutrition/open-food-facts';
import {
  appCodeSha,
  nativeAppVersion,
  nativeApplicationId,
  nativeBuildCode,
} from '../../../integrations/app-info/platform';
import {
  appVersionLine,
  codeVersionLine,
  fetchReleaseBuild,
  fetchServerVersion,
  releaseBuildNotice,
  serverVersionLine,
  type ReleaseBuild,
} from '../../../integrations/app-info/versions';
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
  // undefined while the one fetch is out, null when it failed.
  const [serverVersion, setServerVersion] = useState<string | null | undefined>(undefined);
  // #3723: the newest published release build, for the release app's "newer build" notice.
  const [releaseBuild, setReleaseBuild] = useState<ReleaseBuild | null>(null);
  useEffect(() => {
    let active = true;
    void fetchServerVersion(process.env.EXPO_PUBLIC_API_URL).then((version) => {
      if (active) setServerVersion(version);
    });
    void fetchReleaseBuild(process.env.EXPO_PUBLIC_API_URL).then((build) => {
      if (active) setReleaseBuild(build);
    });
    return () => {
      active = false;
    };
  }, []);
  const notice = releaseBuildNotice(
    nativeApplicationId,
    { version: nativeAppVersion, buildCode: nativeBuildCode },
    releaseBuild,
  );
  return (
    <PageLayout title="About" onBack={onBack}>
      <TabPanel>
        <Stack style={{ paddingHorizontal: theme.spacing.lg }}>
          <Card>
            <AppText variant="hero">TrainingAi</AppText>
            <AppText variant="caption" tone="muted">
              {appVersionLine(nativeAppVersion, nativeBuildCode)}
            </AppText>
            <AppText variant="caption" tone="muted">
              {codeVersionLine(appCodeSha)}
            </AppText>
            <AppText variant="caption" tone="muted">
              {serverVersion === undefined ? 'Server …' : serverVersionLine(serverVersion)}
            </AppText>
            <AppText variant="caption" tone="muted">
              Your training, nutrition and health in one place.
            </AppText>
          </Card>
          {notice && (
            // The current app's amber "New Android build" card (components/more/update-check-card.tsx).
            <Pressable
              accessibilityRole="link"
              accessibilityHint="Opens the download page in the browser"
              onPress={() => void Linking.openURL(notice.pageUrl)}
            >
              <Card accent={theme.status.warning}>
                <AppText variant="label" style={{ color: theme.status.warning }}>
                  {notice.title}
                </AppText>
                <AppText variant="caption" tone="muted">
                  {notice.message}
                </AppText>
              </Card>
            </Pressable>
          )}
          <Card>
            <AppText variant="heading">Feedback</AppText>
            <AppButton
              title="Report a bug, request a feature or ask a question"
              variant="ghost"
              onPress={() => setModal('feedback')}
            />
          </Card>
          <Card>
            <AppText variant="heading">Data sources</AppText>
            <AppText variant="caption" tone="muted">
              {OFF_ATTRIBUTION}
            </AppText>
          </Card>
          <Card>
            <AppText variant="heading">What’s new in v{CHANGELOG[0].version}</AppText>
            {CHANGELOG[0].changes.map((change) => (
              <AppText key={change} variant="caption" tone="muted">
                · {change}
              </AppText>
            ))}
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
