import { deviceHealthName } from '../../../integrations/device-health/platform';
import { FriendsPanel } from '../../social/components/FriendsPanel';
import { FriendCode } from '../../social/components/FriendCode';
import { useState } from 'react';
import { z } from 'zod';
import {
  AppButton,
  AppText,
  Badge,
  Card,
  ExpandableCard,
  FeatureRow,
  Grid,
  Icon,
  ListRow,
  MetricTile,
  PageLayout,
  Section,
  SegmentedControl,
  Stack,
  StatusIndicator,
  TabPanel,
} from '../../../shared/ui';
import { useAccountContext } from '../../account/AccountProvider';
import { useWorkoutResource } from '../../workouts/data/WorkoutDataProvider';
import { profileSpec, goalsSpec, metricValue } from '../../health/data/models';
import { useTheme } from '../../../shared/theme/ThemeProvider';
import { ProfilePhoto } from '../components/ProfilePhoto';
import { ProfileStats } from '../components/ProfileStats';
import { FeedbackSheet } from '../components/FeedbackSheet';
import { DeleteAccountSheet } from '../components/DeleteAccountSheet';
const stats = z
  .object({
    lifetimeStats: z.object({
      sessions: z.number(),
      totalVolumeKg: z.number(),
      bestStreak: z.number(),
      totalSets: z.number(),
      totalDistanceKm: z.number(),
    }),
  })
  .passthrough();
export function MoreScreen({
  openSettings,
  openPrograms,
  openClinical,
  openGoals,
  openProfile,
  openAppleHealth,
  openData,
  openDevices,
  openAbout,
  openYear,
  openFriendProfile,
}: {
  openSettings: () => void;
  openPrograms: () => void;
  openClinical: () => void;
  openGoals: () => void;
  openProfile: () => void;
  openAppleHealth: () => void;
  openData: () => void;
  openDevices: () => void;
  openAbout: () => void;
  openYear: () => void;
  openFriendProfile: (id: string) => void;
}) {
  const account = useAccountContext(),
    { theme } = useTheme();
  const [tab, setTab] = useState('profile'),
    [modal, setModal] = useState<'feedback' | 'delete' | null>(null);
  const profile = useWorkoutResource(profileSpec),
    goals = useWorkoutResource(goalsSpec),
    history = useWorkoutResource({ path: '/api/achievements', schema: stats, ttl: 300000 });
  const user = profile.data?.user;
  const name =
    typeof user?.displayName === 'string'
      ? user.displayName
      : (user?.name ?? account.state.profile?.name ?? 'Your profile');
  const lifetime = history.data?.lifetimeStats;
  const program = useWorkoutResource({
    path: '/api/program-week',
    ttl: 1800000,
    schema: z
      .object({
        mode: z.enum(['cycle', 'tenure']).nullable(),
        weeksRunning: z.number().optional(),
        cycleCurrent: z.number().optional(),
        cycleTotal: z.number().optional(),
        phaseName: z.string().nullable().optional(),
        blockComplete: z.boolean().optional(),
        programName: z.string().nullable(),
      })
      .nullable(),
  });
  return (
    <PageLayout
      title="More"
      subtitle="Profile, achievements & settings"
      actions={
        <StatusIndicator
          label="Profile"
          busy={profile.loading || history.loading}
          error={profile.error ?? history.error}
          onRetry={() => {
            profile.refresh();
            history.refresh();
            goals.refresh();
          }}
        />
      }
    >
      <Stack style={{ paddingHorizontal: theme.spacing.lg }}>
        <SegmentedControl
          label="More views"
          value={tab}
          options={[
            { value: 'profile', label: 'Profile' },
            { value: 'friends', label: 'Friends' },
          ]}
          onChange={setTab}
        />
      </Stack>
      <TabPanel>
        <Stack style={{ paddingHorizontal: theme.spacing.lg }} gap="lg">
          {tab === 'friends' ? (
            <FriendsPanel openProfile={openFriendProfile} />
          ) : (
            <>
              <Stack
                align="center"
                gap="md"
                style={{ paddingTop: theme.spacing.lg, paddingBottom: theme.spacing.sm }}
              >
                <ProfilePhoto name={name} uri={user?.avatar} onSaved={profile.refresh} />
                <Stack align="center" gap="xs" style={{ width: '100%' }}>
                  <AppText variant="pageTitle" style={{ textAlign: 'center' }}>
                    {name}
                  </AppText>
                  <AppText
                    variant="caption"
                    tone="muted"
                    selectable
                    style={{ textAlign: 'center' }}
                  >
                    {account.state.profile?.email ?? 'Sign in to connect your account'}
                  </AppText>
                </Stack>
                <FriendCode
                  code={typeof user?.friendCode === 'string' ? user.friendCode : null}
                />
              </Stack>
              <ProfileStats lifetime={lifetime} program={program.data} />
              <Card>
                <Stack direction="row" align="center">
                  <Icon name="award" tone="brand" />
                  <AppText variant="label" style={{ flex: 1 }}>
                    Trophy case
                  </AppText>
                  <Badge label="Coming soon" style={{ alignSelf: 'center' }} />
                </Stack>
              </Card>
              <Card padded={false}>
                <ListRow
                  title="Your Year"
                  leading={<Icon name="award" />}
                  onPress={openYear}
                  divider={false}
                />
              </Card>
              <ExpandableCard
                title="My goals"
                icon="target"
                subtitle="Training, health & nutrition targets"
              >
                <Grid columns={2}>
                  {[
                    ['Target weight', goals.data?.targetWeightKg, 'kg'],
                    ['Target body fat', goals.data?.targetBfPct, '%'],
                    ['Steps', goals.data?.stepsGoal, ''],
                    ['Sleep', goals.data?.sleepGoalHours, 'h'],
                    ['Water', goals.data?.waterGoalMl, 'ml'],
                  ].map(([label, value, unit]) => (
                    <MetricTile
                      key={String(label)}
                      label={String(label)}
                      value={metricValue(typeof value === 'number' ? value : null)}
                      unit={String(unit)}
                    />
                  ))}
                </Grid>
                <AppButton title="Edit goals" variant="ghost" onPress={openGoals} />
              </ExpandableCard>
              <Section title="Your setup">
                <ListRow
                  title="Profile details"
                  leading={<Icon name="info" />}
                  onPress={openProfile}
                />
                <ListRow
                  title="Programs & schedule"
                  leading={<Icon name="workout" />}
                  onPress={openPrograms}
                />
                <ListRow
                  title="DEXA & RMR results"
                  leading={<Icon name="scale" />}
                  onPress={openClinical}
                />
                <ListRow
                  title={deviceHealthName}
                  subtitle="Connection, permissions and data sources"
                  leading={<Icon name="health" />}
                  onPress={openAppleHealth}
                />
                <ListRow
                  title="Devices & connections"
                  subtitle="Oura account"
                  leading={<Icon name="activity" />}
                  onPress={openDevices}
                />
                <FeatureRow
                  title="Collection"
                  leading={<Icon name="award" />}
                  divider={false}
                />
              </Section>
              <Section title="App">
                <ListRow
                  title="Settings"
                  subtitle="Appearance, notifications & Home layout"
                  leading={<Icon name="settings" />}
                  onPress={openSettings}
                />
                <ListRow
                  title="Data & Sync"
                  leading={<Icon name="refresh" />}
                  onPress={openData}
                />
                <ListRow
                  title="About TrainingAi"
                  leading={<Icon name="info" />}
                  onPress={openAbout}
                  divider={user?.isAdmin === true}
                />
                {user?.isAdmin === true && (
                  <FeatureRow
                    title="Admin Console"
                    leading={<Icon name="settings" />}
                    divider={false}
                  />
                )}
              </Section>
              <Section title="Feedback">
                <ListRow
                  title="Feedback & requests"
                  leading={<Icon name="coach" />}
                  onPress={() => setModal('feedback')}
                  divider={false}
                />
              </Section>
              <Section title="Account">
                <ListRow
                  title="Account & sign-in settings"
                  leading={<Icon name="users" />}
                  onPress={openSettings}
                />
                <ListRow
                  title="Delete account"
                  leading={<Icon name="delete" tone="danger" />}
                  disabled={!account.dataReader}
                  onPress={() => setModal('delete')}
                  divider={false}
                />
              </Section>
            </>
          )}
        </Stack>
      </TabPanel>
      {modal === 'feedback' && <FeedbackSheet onClose={() => setModal(null)} />}
      {modal === 'delete' && <DeleteAccountSheet onClose={() => setModal(null)} />}
    </PageLayout>
  );
}
