import { PageLayout, Stack, TabPanel } from '../../../shared/ui';
import { useTheme } from '../../../shared/theme/ThemeProvider';
import { AccountPanel } from '../../account/components/AccountPanel';

/** More → Account & sign-in settings: the account card on its own. Before this the row opened the
 *  whole Settings screen, with the account card at the bottom of it (#2936). */
export function AccountScreen({ onBack }: { onBack: () => void }) {
  const { theme } = useTheme();
  return (
    <PageLayout title="Account" onBack={onBack}>
      <TabPanel>
        <Stack style={{ paddingHorizontal: theme.spacing.lg }}>
          <AccountPanel />
        </Stack>
      </TabPanel>
    </PageLayout>
  );
}
