import { useEffect, useState } from 'react';
import { AppState, Linking } from 'react-native';
import {
  nativeApplicationId,
  nativeBuildCode,
} from '../../../integrations/app-info/platform';
import {
  fetchMinimumBuild,
  tooOldNotice,
  type TooOldNotice,
} from '../../../integrations/app-info/versions';
import { AppButton, AppText, Card, PageLayout, Stack } from '../../../shared/ui';
import { useTheme } from '../../../shared/theme/ThemeProvider';
import { SignOutSheet } from '../../settings/components/SignOutSheet';

/**
 * #3724. The "too old" notice for this build, or null. Reads the server's minimum at launch and
 * whenever the app comes back to the foreground; null (nothing shown) until it answers, on any
 * failure, and while the minimum is null.
 */
export function useTooOldNotice(): TooOldNotice | null {
  const [minimum, setMinimum] = useState<number | null>(null);
  useEffect(() => {
    let active = true;
    const check = () =>
      void fetchMinimumBuild(process.env.EXPO_PUBLIC_API_URL).then((value) => {
        if (active) setMinimum(value);
      });
    check();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') check();
    });
    return () => {
      active = false;
      subscription.remove();
    };
  }, []);
  return tooOldNotice(nativeApplicationId, nativeBuildCode, minimum);
}

/**
 * Covers the app while this build is below the server's minimum. Sign-out, data export and sync
 * health stay reachable from it: the data screen opens over it, and sign-out is its own sheet.
 */
export function TooOldScreen({
  notice,
  onOpenData,
}: {
  notice: TooOldNotice;
  onOpenData: () => void;
}) {
  const { theme } = useTheme();
  const [signingOut, setSigningOut] = useState(false);
  return (
    <PageLayout title="TrainingAi">
      <Stack style={{ paddingHorizontal: theme.spacing.lg }}>
        <Card accent={theme.status.warning} accessibilityRole="alert">
          <AppText variant="heading">{notice.title}</AppText>
          <AppText tone="muted">{notice.message}</AppText>
          <AppButton
            title="Download the new build"
            accessibilityHint="Opens the download page in the browser"
            onPress={() => void Linking.openURL(notice.pageUrl)}
          />
        </Card>
        <Card>
          <AppButton title="Export data and sync health" variant="ghost" onPress={onOpenData} />
          <AppButton title="Sign out" variant="ghost" onPress={() => setSigningOut(true)} />
        </Card>
      </Stack>
      {signingOut && <SignOutSheet onClose={() => setSigningOut(false)} />}
    </PageLayout>
  );
}
