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
import { AdminActivityTypesPanel } from '../components/AdminActivityTypesPanel';
import { AdminAiUsagePanel } from '../components/AdminAiUsagePanel';
import { AdminErrorsPanel } from '../components/AdminErrorsPanel';
import { AdminExercisesPanel } from '../components/AdminExercisesPanel';
import { AdminUnitFixPanel } from '../components/AdminUnitFixPanel';
import { AdminFeedbackPanel } from '../components/AdminFeedbackPanel';
import { AdminInvitesPanel } from '../components/AdminInvitesPanel';
import { AdminUsersPanel } from '../components/AdminUsersPanel';
import { adminActivityTypesSpec, adminExercisesSpec, adminUnitFixNamesSpec } from '../data/admin-content';
import { adminErrorsSpec } from '../data/admin-monitoring';
import { adminFeedbackSpec, adminInvitesSpec, adminUsersSpec } from '../data/admin-users';

type Tab =
  | 'users'
  | 'invites'
  | 'feedback'
  | 'errors'
  | 'ai'
  | 'exercises'
  | 'activities'
  | 'units';

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
  // The rest load when their tab opens.
  const errors = useWorkoutResource(adminErrorsSpec, admin && tab === 'errors');
  const exercises = useWorkoutResource(adminExercisesSpec, admin && tab === 'exercises');
  const activities = useWorkoutResource(adminActivityTypesSpec, admin && tab === 'activities');
  const unitNames = useWorkoutResource(adminUnitFixNamesSpec, admin && tab === 'units');
  const inactive = users.data ? users.data.users.filter((u) => !u.isActive).length : 0;
  const timezone = typeof user?.timezone === 'string' ? user.timezone : undefined;
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
  const resourceFor = {
    users, invites, feedback, errors, exercises, activities, units: unitNames,
  } as const;
  // AI usage reads its own windowed resource and shows its own loading and error states.
  const active = tab === 'ai' ? null : resourceFor[tab];
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
                { label: 'Errors', value: 'errors' },
                { label: 'AI usage', value: 'ai' },
                { label: 'Exercises', value: 'exercises' },
                { label: 'Activities', value: 'activities' },
                { label: 'Unit fix', value: 'units' },
              ]}
            />
          </ScrollView>
          {tab === 'ai' ? (
            <AdminAiUsagePanel />
          ) : active && active.error && !active.data ? (
            <StateCard error title="Could not load" message={active.error} action="Retry" onAction={active.refresh} />
          ) : active && !active.data ? (
            <LoadingIndicator accessibilityLabel="Loading" />
          ) : tab === 'users' ? (
            <AdminUsersPanel users={users.data?.users ?? []} currentUserId={typeof user?.id === 'string' ? user.id : null} />
          ) : tab === 'invites' ? (
            <AdminInvitesPanel emails={invites.data?.emails ?? []} />
          ) : tab === 'feedback' ? (
            <AdminFeedbackPanel items={feedback.data ?? []} timezone={timezone} />
          ) : tab === 'errors' ? (
            <AdminErrorsPanel events={errors.data ?? []} timezone={timezone} />
          ) : tab === 'exercises' ? (
            <AdminExercisesPanel exercises={exercises.data?.exercises ?? []} />
          ) : tab === 'activities' ? (
            <AdminActivityTypesPanel types={activities.data?.activityTypes ?? []} />
          ) : (
            <AdminUnitFixPanel exerciseNames={unitNames.data?.exerciseNames ?? []} />
          )}
          {active && <AppButton title="Refresh" variant="ghost" onPress={active.refresh} />}
        </Stack>
      </TabPanel>
    </PageLayout>
  );
}
