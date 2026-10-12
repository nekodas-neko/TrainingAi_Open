import { Card, Avatar, Stack, AppText, Section, FeatureRow } from '../../../shared/ui';
import { useAccountContext } from '../../account/AccountProvider';

export function MoreScreen({
  openSettings,
  openPrograms,
  openLibrary,
  openHistory,
  openStrength,
  openClinical,
  openGoals,
}: {
  openSettings: () => void;
  openPrograms: () => void;
  openLibrary: () => void;
  openHistory: () => void;
  openStrength: () => void;
  openClinical: () => void;
  openGoals:()=>void;
}) {
  const { state } = useAccountContext();
  return (
    <>
      <Card tone="brand">
        <Stack direction="row" align="center" gap="lg">
          <Avatar name={state.profile?.name ?? state.profile?.email ?? 'You'} />
          <Stack gap="xs" style={{ flex: 1 }}>
            <AppText variant="heading">
              {state.profile?.name ?? state.profile?.email ?? 'Your account'}
            </AppText>
            <AppText variant="caption" tone="muted">
              {state.status === 'loading'
                ? 'Loading account…'
                : state.status === 'signingIn'
                  ? 'Signing in…'
                  : state.status === 'checking'
                    ? 'Checking account…'
                    : state.profile
                      ? 'Signed in'
                      : state.hasSession
                        ? 'Account verification needed'
                        : 'Sign in to connect your account'}
            </AppText>
          </Stack>
        </Stack>
      </Card>
      <Section title="You">
        <FeatureRow
          title="Account & settings"
          subtitle="Sign-in, account details and app settings"
          onPress={openSettings}
        />
        <FeatureRow
          onPress={openGoals}
          title="Profile & goals"
          subtitle="Your details, fitness goals and preferences"
        />
        <FeatureRow
          title="Progress & reviews"
          subtitle="History, trends and weekly reviews"
          onPress={openStrength}
        />
        <FeatureRow
          title="DEXA & RMR"
          subtitle="Body-composition scans and metabolic tests"
          onPress={openClinical}
        />
      </Section>
      <Section title="Training">
        <FeatureRow
          title="Programs"
          subtitle="Sessions, schedules and progression"
          onPress={openPrograms}
        />
        <FeatureRow title="Exercise library" onPress={openLibrary} />
        <FeatureRow title="Workout history" onPress={openHistory} />
      </Section>
      <Section title="Coaching & community">
        <FeatureRow title="AI coach" subtitle="Conversations and personalised guidance" />
        <FeatureRow title="Friends & feed" subtitle="Connect and share your progress" />
        <FeatureRow title="Leaderboards" subtitle="See how your progress compares" />
        <FeatureRow
          title="Achievements & rewards"
          subtitle="Milestones, levels and collections"
        />
      </Section>
      <Section title="App preferences">
        <FeatureRow
          title="Appearance"
          subtitle="Theme and accent colour"
          onPress={openSettings}
        />
        <FeatureRow title="Notifications & reminders" />
        <FeatureRow title="Integrations & calendar" />
        <FeatureRow title="Data & sync" subtitle="Sync status, export and backup" />
        <FeatureRow title="Help & feedback" />
      </Section>
    </>
  );
}
