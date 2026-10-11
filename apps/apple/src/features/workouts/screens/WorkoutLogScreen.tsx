import { Share, View } from 'react-native';
import {
  AppButton,
  AppText,
  Badge,
  Card,
  Grid,
  Icon,
  Notice,
  PageLayout,
  Stack,
  StateCard,
} from '../../../shared/ui';
import { useTheme } from '../../../shared/theme/ThemeProvider';
import { formatDuration } from '../../../shared/hooks/useClock';
import { useWorkoutJournal } from '../logging/WorkoutJournalProvider';
import { WorkoutSaveNotice } from '../components/WorkoutSaveNotice';
import { GuidedWorkoutScreen } from './GuidedWorkoutScreen';
import { workoutResult } from '../logging/summary';
import { WorkoutLayout } from '../components/WorkoutLayout';
import { ResourceCard } from '../components/ResourceCard';
import { NextPrescription } from '../components/NextPrescription';
import { recapSpec } from '../data/models';
import { WorkoutEnergy } from '../components/WorkoutEnergy';

export function WorkoutLogScreen({
  workoutId,
  openSettings,
  closeWorkout,
}: {
  workoutId: string | null;
  openSettings: () => void;
  closeWorkout: () => void;
}) {
  const journal = useWorkoutJournal();
  const { theme } = useTheme();
  const workout = journal.data.workouts.find((workout) => workout.id === workoutId);
  if (journal.controller && journal.ready && workout?.status === 'active') {
    return <GuidedWorkoutScreen key={workout.id} workout={workout} closeWorkout={closeWorkout} />;
  }
  if (!journal.controller || !journal.ready || !workout || workout.status === 'discarded') {
    return (
      <WorkoutLayout title="Workout" onBack={closeWorkout}>
        {!journal.controller ? (
          <StateCard
            title="Connect your account"
            message="Sign in to resume your saved workout."
            action="Account & settings"
            onAction={openSettings}
          />
        ) : !journal.ready ? (
          <StateCard
            title="Saved workouts"
            message={journal.message ?? 'Opening saved progress…'}
            loading={journal.busy}
            action={journal.busy ? undefined : 'Retry loading'}
            onAction={() => {
              void journal.controller?.initialize();
            }}
          />
        ) : (
          <StateCard
            title="Workout unavailable"
            message="Go back to choose or resume a workout for this account."
            action="Back to Workout"
            onAction={closeWorkout}
          />
        )}
      </WorkoutLayout>
    );
  }
  const result = workoutResult(workout);
  const duration = formatDuration((workout.completedAt! - workout.startedAt) / 1000);
  const stats = [
    {
      label: 'Exercises',
      value: `${result.exercises}/${workout.exercises.filter((exercise) => !exercise.retired && !exercise.relogOf).length}`,
    },
    { label: 'Total time', value: duration },
    { label: 'Sets', value: String(result.sets) },
    { label: 'Volume', value: `${Math.round(result.loadVolume).toLocaleString()} kg` },
  ];
  return (
    <PageLayout
      title="Workout complete"
      hideHeader
      scroll
      contentStyle={{ alignItems: 'center', gap: theme.spacing.xl, paddingTop: theme.spacing.xxl }}
    >
      <View
        style={{
          width: theme.sizes.demonstration * 1.5,
          height: theme.sizes.demonstration * 1.5,
          borderRadius: theme.radii.pill,
          backgroundColor: theme.colors.brandSurface,
          borderWidth: 1,
          borderColor: theme.colors.brandBorder,
          justifyContent: 'center',
          alignItems: 'center',
        }}
      >
        <Icon name="check" size={theme.sizes.button} tone="brand" />
      </View>
      <AppText variant="title" style={{ textAlign: 'center' }}>
        You crushed it!
      </AppText>
      <AppText variant="caption" tone="muted">
        {workout.sessionName}
      </AppText>
      <Badge
        label={
          workout.pending.length === 0
            ? 'Saved to your account'
            : journal.syncing
              ? 'Uploading…'
              : 'Saved on phone · upload pending'
        }
        tone="brand"
        style={{ alignSelf: 'center' }}
      />
      {workout.pending.length > 0 && (
        <AppButton
          title="Retry upload"
          variant="ghost"
          busy={journal.syncing}
          onPress={() => {
            void journal.controller?.sync();
          }}
        />
      )}
      {workout.syncError && <Notice title="Upload pending" message={workout.syncError} />}
      <WorkoutSaveNotice />
      <View style={{ width: '100%', maxWidth: theme.sizes.summaryWidth }}>
        <Grid>
          {stats.map((stat) => (
            <Card key={stat.label} style={{ flex: 1, padding: theme.spacing.md }}>
              <AppText variant="eyebrow" tone="muted" style={{ textAlign: 'center' }}>
                {stat.label}
              </AppText>
              <AppText variant="pageTitle" tone="brand" style={{ textAlign: 'center' }}>
                {stat.value}
              </AppText>
            </Card>
          ))}
        </Grid>
      </View>
      <Card style={{ width: '100%', maxWidth: theme.sizes.summaryWidth }}>
        <AppText variant="eyebrow" tone="muted">
          Time summary
        </AppText>
        {[
          { label: 'Warm-up', seconds: result.warmupSeconds },
          { label: 'Set work', seconds: result.timedSetSeconds },
          { label: 'Rest', seconds: result.restSeconds },
        ].map((item) => (
          <Stack key={item.label} direction="row" justify="space-between">
            <AppText variant="caption" tone="muted">
              {item.label}
            </AppText>
            <AppText variant="label">
              {item.seconds === null ? 'Not timed' : formatDuration(item.seconds)}
            </AppText>
          </Stack>
        ))}
      </Card>
      <WorkoutEnergy workout={workout} />
      <ResourceCard
        title="Session recap"
        spec={recapSpec(workout.id)}
        disabled={workout.pending.length > 0}
      >
        {(data) => <AppText>{data.recap ?? 'No recap is available yet.'}</AppText>}
      </ResourceCard>
      <Card style={{ width: '100%', maxWidth: theme.sizes.summaryWidth }}>
        <AppText variant="eyebrow" tone="muted">
          HR recovery
        </AppText>
        <AppText variant="micro" tone="muted">
          Device integration is not connected.
        </AppText>
      </Card>
      <NextPrescription />
      <Stack style={{ width: '100%', maxWidth: theme.sizes.summaryWidth }}>
        <AppButton title="Ask AI Coach · coming soon" disabled />
        <Stack direction="row">
          <AppButton
            title="Share"
            icon="share"
            variant="surface"
            onPress={() => {
              void Share.share({
                message: `Workout complete! ${workout.sessionName} · ${result.exercises} exercises · ${result.sets} sets · ${duration} · ${Math.round(result.loadVolume)} kg volume`,
              });
            }}
            style={{ flex: 1 }}
          />
          <AppButton title="Done" variant="surface" onPress={closeWorkout} style={{ flex: 1 }} />
        </Stack>
      </Stack>
    </PageLayout>
  );
}
