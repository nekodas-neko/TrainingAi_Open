import { FriendsPanel } from '../../social/components/FriendsPanel';
import { FriendCode } from '../../social/components/FriendCode';
import { useState } from 'react';
import { z } from 'zod';
import {
  AppButton,
  AppText,
  Card,
  Disclosure,
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
  openAppleHealth,
  openData,
  openAbout,
  openYear,
  openFriendProfile,
}: {
  openSettings: () => void;
  openPrograms: () => void;
  openClinical: () => void;
  openGoals: () => void;
  openAppleHealth: () => void;
  openData: () => void;
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
        <Stack style={{ paddingHorizontal: theme.spacing.lg }}>
          {tab === 'friends' ? (
            <FriendsPanel openProfile={openFriendProfile} />
          ) : (
            <>
              <Stack align="center">
                <ProfilePhoto name={name} uri={user?.avatar} onSaved={profile.refresh} />
                <AppText variant="hero">{name}</AppText>
                <AppText variant="caption" tone="muted">
                  {account.state.profile?.email ?? 'Sign in to connect your account'}
                </AppText>
              </Stack>
              <FriendCode
                code={typeof user?.friendCode === 'string' ? user.friendCode : null}
              />
              <Grid columns={3}>
                {[
                  ['Sessions', lifetime?.sessions, ''],
                  ['Sets', lifetime?.totalSets, ''],
                  ['Volume', lifetime?.totalVolumeKg, 'kg'],
                  ['Best streak', lifetime?.bestStreak, 'days'],
                  ['Distance', lifetime?.totalDistanceKm, 'km'],
                  [
                    program.data?.mode === 'cycle'
                      ? (program.data.phaseName ?? 'Cycle')
                      : 'Weeks running',
                    program.data?.mode === 'cycle'
                      ? `${program.data.cycleCurrent ?? '—'}/${program.data.cycleTotal ?? '—'}`
                      : program.data?.weeksRunning,
                    '',
                  ],
                ].map(([label, value, unit]) => (
                  <MetricTile
                    key={String(label)}
                    label={String(label)}
                    value={
                      typeof value === 'number'
                        ? value.toLocaleString()
                        : typeof value === 'string'
                          ? value
                          : '—'
                    }
                    unit={String(unit)}
                  />
                ))}
              </Grid>
              <Card>
                <FeatureRow
                  title="Trophy case & achievements"
                  subtitle="Deferred with rewards and collections"
                />
              </Card>
              <ListRow title="Your Year" leading={<Icon name="award" />} onPress={openYear} />
              <Card>
                <Disclosure title="My goals">
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
                </Disclosure>
              </Card>
              <Section title="Your setup">
                <Card padded={false}>
                  <ListRow
                    title="Profile details"
                    leading={<Icon name="info" />}
                    onPress={openGoals}
                  />
                  <ListRow
                    title="Sessions, progression & schedule"
                    leading={<Icon name="workout" />}
                    onPress={openPrograms}
                  />
                  <ListRow
                    title="DEXA & RMR results"
                    leading={<Icon name="scale" />}
                    onPress={openClinical}
                  />
                  <ListRow
                    title="Apple Health"
                    subtitle="Connection, permissions and data sources"
                    leading={<Icon name="health" />}
                    onPress={openAppleHealth}
                  />
                  <FeatureRow
                    title="Ring, strap, scale & permissions"
                    subtitle="Direct devices remain deferred"
                  />
                  <FeatureRow title="Collection" subtitle="Deferred with rewards" />
                </Card>
              </Section>
              <Section title="App">
                <Card padded={false}>
                  <ListRow
                    title="Notifications, appearance & home layout"
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
                  />
                  {user?.isAdmin === true && (
                    <FeatureRow
                      title="Admin Console"
                      subtitle="Native admin tools are not in this migration pass"
                    />
                  )}
                </Card>
              </Section>
              <Section title="Feedback">
                <Card padded={false}>
                  <ListRow title="Feedback & requests" onPress={() => setModal('feedback')} />
                </Card>
              </Section>
              <AppButton
                title="Account & sign-in settings"
                variant="ghost"
                onPress={openSettings}
              />
              <AppButton
                title="Delete account"
                variant="ghost"
                disabled={!account.dataReader}
                onPress={() => setModal('delete')}
              />
            </>
          )}
        </Stack>
      </TabPanel>
      {modal === 'feedback' && <FeedbackSheet onClose={() => setModal(null)} />}
      {modal === 'delete' && <DeleteAccountSheet onClose={() => setModal(null)} />}
    </PageLayout>
  );
}
