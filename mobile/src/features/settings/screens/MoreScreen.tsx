import { deviceHealthName } from '../../../integrations/device-health/platform';
import { FriendsPanel } from '../../social/components/FriendsPanel';
import { FriendCode } from '../../social/components/FriendCode';
import { useState } from 'react';
import { z } from 'zod';
import {
  AppButton,
  AppText,
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
import { useWorkoutContext } from '../../workouts/WorkoutProvider';
import { profileSpec, goalsSpec, metricValue } from '../../health/data/models';
import { useTheme } from '../../../shared/theme/ThemeProvider';
import { ProfilePhoto } from '../components/ProfilePhoto';
import { ProfileStats } from '../components/ProfileStats';
import { FeedbackSheet } from '../components/FeedbackSheet';
import { DeleteAccountSheet } from '../components/DeleteAccountSheet';
import { SignOutSheet } from '../components/SignOutSheet';
import { memberSinceLabel, moreCopy } from '../data/profile';
import { useRewards } from '../../rewards/data/useRewards';
import { LevelHeader } from '../../rewards/components/LevelHeader';
import { AchievementsSection } from '../../rewards/components/AchievementsSection';
import { TrophyCase } from '../../rewards/components/TrophyCase';
import { TitleButton } from '../../rewards/components/TitleButton';
import { SeasonBadges } from '../../rewards/components/SeasonBadges';
import { seasonsSpec } from '../../rewards/data/models';
export function MoreScreen({
  openSettings,
  openAccount,
  openPrograms,
  openClinical,
  openGoals,
  openProfile,
  openAppleHealth,
  openData,
  openDevices,
  openAbout,
  openYear,
  openCollection,
  openFriendProfile,
}: {
  openSettings: () => void;
  openAccount: () => void;
  openPrograms: () => void;
  openClinical: () => void;
  openGoals: () => void;
  openProfile: () => void;
  openAppleHealth: () => void;
  openData: () => void;
  openDevices: () => void;
  openAbout: () => void;
  openYear: () => void;
  openCollection: () => void;
  openFriendProfile: (id: string) => void;
}) {
  const account = useAccountContext(),
    { theme } = useTheme(),
    { timezone } = useWorkoutContext();
  const [tab, setTab] = useState('profile'),
    [modal, setModal] = useState<'feedback' | 'delete' | 'signout' | null>(null);
  const profile = useWorkoutResource(profileSpec),
    goals = useWorkoutResource(goalsSpec),
    history = useRewards(),
    seasons = useWorkoutResource(seasonsSpec);
  const user = profile.data?.user;
  const name =
    typeof user?.displayName === 'string'
      ? user.displayName
      : (user?.name ?? account.state.profile?.name ?? 'Your profile');
  const lifetime = history.data?.lifetimeStats;
  const memberSince = memberSinceLabel(user?.createdAt, timezone);
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
          busy={profile.loading || history.loading || seasons.loading}
          error={profile.error ?? history.error ?? seasons.error}
          onRetry={() => {
            profile.refresh();
            history.refresh();
            seasons.refresh();
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
          appearance="tabs"
          size="xs"
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
                  <TitleButton
                    equipped={typeof user?.equippedTitle === 'string' ? user.equippedTitle : null}
                    unlockedIds={
                      history.data?.achievements.filter((row) => row.unlocked).map((row) => row.id) ?? []
                    }
                  />
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
                <LevelHeader rewards={history.data} failed={!!history.error} />
              </Stack>
              <ProfileStats
                lifetime={lifetime}
                program={program.data}
                memberSince={memberSince}
              />
              {history.data && <TrophyCase achievements={history.data.achievements} />}
              <AchievementsSection rewards={history.data} loading={history.loading} />
              <Card padded={false}>
                <ListRow
                  title={moreCopy.year.title}
                  density="snug"
                  leading={<Icon name="coach" tone="muted" size={theme.sizes.iconCompact} />}
                  trailing={
                    <AppText variant="caption" tone="muted">
                      {moreCopy.year.action}
                    </AppText>
                  }
                  onPress={openYear}
                  divider={false}
                />
              </Card>
              <SeasonBadges seasons={seasons.data?.seasons ?? []} />
              <ExpandableCard
                title={moreCopy.goals.title}
                icon="target"
                subtitle={moreCopy.goals.subtitle}
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
                  density="snug"
                  divider={false}
                  title="Profile details"
                  leading={<Icon name="userRound" tone="muted" size={theme.sizes.iconCompact} />}
                  onPress={openProfile}
                />
                <ListRow
                  density="snug"
                  divider={false}
                  title="Sessions, progression & schedule"
                  leading={<Icon name="workout" tone="muted" size={theme.sizes.iconCompact} />}
                  onPress={openPrograms}
                />
                <ListRow
                  density="snug"
                  divider={false}
                  title="DEXA & RMR results"
                  leading={<Icon name="scan" tone="muted" size={theme.sizes.iconCompact} />}
                  onPress={openClinical}
                />
                <ListRow
                  density="snug"
                  divider={false}
                  title={deviceHealthName}
                  subtitle="Connection, permissions and data sources"
                  leading={<Icon name="health" tone="muted" size={theme.sizes.iconCompact} />}
                  onPress={openAppleHealth}
                />
                <ListRow
                  density="snug"
                  divider={false}
                  title="Devices & connections"
                  subtitle="Oura account, heart-rate strap"
                  leading={<Icon name="bluetooth" tone="muted" size={theme.sizes.iconCompact} />}
                  onPress={openDevices}
                />
                <ListRow
                  density="snug"
                  title="Collection"
                  leading={<Icon name="cat" tone="muted" size={theme.sizes.iconCompact} />}
                  onPress={openCollection}
                  divider={false}
                />
              </Section>
              <Section title="App">
                <ListRow
                  density="snug"
                  divider={false}
                  title="Notifications, appearance & home layout"
                  leading={<Icon name="settings" tone="muted" size={theme.sizes.iconCompact} />}
                  onPress={openSettings}
                />
                <ListRow
                  density="snug"
                  divider={false}
                  title="Data & Sync"
                  leading={<Icon name="cloudDownload" tone="muted" size={theme.sizes.iconCompact} />}
                  onPress={openData}
                />
                <ListRow
                  density="snug"
                  title="About TrainingAi"
                  leading={<Icon name="info" tone="muted" size={theme.sizes.iconCompact} />}
                  onPress={openAbout}
                  divider={false}
                />
                {user?.isAdmin === true && (
                  <FeatureRow
                    density="snug"
                    title="Admin Console"
                    leading={<Icon name="shieldPlain" tone="muted" size={theme.sizes.iconCompact} />}
                    divider={false}
                  />
                )}
              </Section>
              {/* The current app's direct actions (#2902). */}
              <Stack gap="sm">
                <AppButton
                  title={moreCopy.actions.report}
                  icon="report"
                  variant="ghost"
                  onPress={() => setModal('feedback')}
                />
                <AppButton
                  title={moreCopy.actions.edit}
                  icon="settings"
                  variant="surface"
                  style={{ alignSelf: 'flex-start' }}
                  onPress={openProfile}
                />
                {account.state.hasSession && (
                  <AppButton
                    title={moreCopy.actions.signOut}
                    icon="signOut"
                    variant="danger"
                    onPress={() => setModal('signout')}
                  />
                )}
              </Stack>
              <Section title="Account">
                <ListRow
                  density="compact"
                  title="Account & sign-in settings"
                  leading={<Icon name="users" />}
                  onPress={openAccount}
                />
                <ListRow
                  density="compact"
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
      {modal === 'signout' && <SignOutSheet onClose={() => setModal(null)} />}
    </PageLayout>
  );
}
