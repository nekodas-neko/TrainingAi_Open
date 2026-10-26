import { useState } from 'react';
import { ScrollView } from 'react-native';
import {
  AppButton,
  AppText,
  LoadingIndicator,
  PageLayout,
  SegmentedControl,
  Stack,
  StateCard,
  TabPanel,
} from '../../../shared/ui';
import { useTheme } from '../../../shared/theme/ThemeProvider';
import { useWorkoutResource } from '../../workouts/data/WorkoutDataProvider';
import { profileSpec } from '../../health/data/models';
import { AdminFeedbackPanel } from '../components/AdminFeedbackPanel';
import { AdminInvitesPanel } from '../components/AdminInvitesPanel';
import { AdminUsersPanel } from '../components/AdminUsersPanel';
import { adminFeedbackSpec, adminInvitesSpec, adminUsersSpec } from '../data/admin-users';

type Tab = 'users' | 'invites' | 'feedback';

/** The current app's admin console, for admins. The server checks `requireAdmin` on every route; this only hides the door. */
export function AdminConsoleScreen({ onBack }: { onBack: () => void }) {
  const { theme } = useTheme();
  const [tab, setTab] = useState<Tab>('users');
  const profile = useWorkoutResource(profileSpec);
  const user = profile.data?.user;
  const admin = user?.isAdmin === true;
  const users = useWorkoutResource(adminUsersSpec, admin);
  const invites = useWorkoutResource(adminInvitesSpec, admin);
  const feedback = useWorkoutResource(adminFeedbackSpec, admin);
  const inactive = users.data ? users.data.users.filter((u) => !u.isActive).length : 0;
  const feedbackCount = feedback.data?.length ?? 0;

  if (!admin) {
    return (
      <PageLayout title="Admin Console" onBack={onBack}>
        <TabPanel>
          <Stack style={{ paddingHorizontal: theme.spacing.lg }}>
            {profile.data ? (
              <StateCard title="Admins only" message="This account is not an admin." />
            ) : (
              <LoadingIndicator accessibilityLabel="Loading" />
            )}
          </Stack>
        </TabPanel>
      </PageLayout>
    );
  }
  const active = tab === 'users' ? users : tab === 'invites' ? invites : feedback;
  return (
    <PageLayout
      title="Admin Console"
      subtitle={`${users.data?.users.length ?? 0} users · ${invites.data?.emails.length ?? 0} invites`}
      onBack={onBack}
    >
      <TabPanel>
        <Stack style={{ paddingHorizontal: theme.spacing.lg }}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <SegmentedControl<Tab>
              label="Admin sections"
              appearance="tabs"
              size="xs"
              value={tab}
              onChange={setTab}
              options={[
                { label: `Users${inactive > 0 ? ` (${inactive})` : ''}`, value: 'users' },
                { label: 'Invites', value: 'invites' },
                { label: `Feedback${feedbackCount > 0 ? ` (${feedbackCount})` : ''}`, value: 'feedback' },
              ]}
            />
          </ScrollView>
          {active.error && !active.data ? (
            <StateCard
              error
              title="Could not load"
              message={active.error}
              action="Retry"
              onAction={active.refresh}
            />
          ) : !active.data ? (
            <LoadingIndicator accessibilityLabel="Loading" />
          ) : tab === 'users' ? (
            <AdminUsersPanel users={users.data?.users ?? []} currentUserId={typeof user?.id === 'string' ? user.id : null} />
          ) : tab === 'invites' ? (
            <AdminInvitesPanel emails={invites.data?.emails ?? []} />
          ) : (
            <AdminFeedbackPanel items={feedback.data ?? []} timezone={typeof user?.timezone === 'string' ? user.timezone : undefined} />
          )}
          <AppButton title="Refresh" variant="ghost" onPress={active.refresh} />
        </Stack>
      </TabPanel>
    </PageLayout>
  );
}
