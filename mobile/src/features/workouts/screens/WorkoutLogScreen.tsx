import { useEffect, useRef } from 'react';
import { feedback } from '../../../integrations/feedback/haptics';
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
import { RecapCard } from '../components/RecapCard';
import { NextPrescription } from '../components/NextPrescription';
import { WorkoutTiming } from '../components/WorkoutTiming';
import { WorkoutHrRecovery } from '../components/WorkoutHrRecovery';
import { WorkoutEnergy } from '../components/WorkoutEnergy';
import { useTrainingKeepAwake } from '../../platform/useTrainingKeepAwake';
import { useWorkoutXp } from '../../rewards/data/useRewards';
import { WorkoutXp } from '../../rewards/components/WorkoutXp';
import { WorkoutCalendarAction } from '../../platform/components/WorkoutCalendarAction';

export function WorkoutLogScreen({
  openCoach,
  workoutId,
  openSettings,
  closeWorkout,
  minimizeWorkout,
}: {
  openCoach?: () => void;
  workoutId: string | null;
  openSettings: () => void;
  closeWorkout: () => void;
  minimizeWorkout: () => void;
}) {
  const journal = useWorkoutJournal();
  const { theme } = useTheme();
  const workout = journal.data.workouts.find((workout) => workout.id === workoutId);
  const xp = useWorkoutXp(workout);
  useTrainingKeepAwake(workout?.status === 'active');
  const previousStatus = useRef({ id: workoutId, status: workout?.status });
  useEffect(() => {
    if (
      previousStatus.current.id === workoutId &&
      previousStatus.current.status === 'active' &&
      workout?.status === 'completed'
    )
      feedback('success');
    previousStatus.current = { id: workoutId, status: workout?.status };
  }, [workoutId, workout?.status]);
  if (journal.controller && journal.ready && workout?.status === 'active') {
    return (
      <GuidedWorkoutScreen
        key={workout.id}
        workout={workout}
        closeWorkout={() => {
          if (journal.busy) {
            return;
          }
          void (async () => {
            if (journal.saveStatus !== 'saved') {
              await journal.controller?.retrySave();
            }
            if (journal.controller?.getSnapshot().saveStatus === 'saved') {
              minimizeWorkout();
            }
          })();
        }}
      />
    );
  }
  if (
    !journal.controller ||
    !journal.ready ||
    !workout ||
    workout.status === 'discarded'
  ) {
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
      onBack={closeWorkout}
      hideHeader
      scroll
      contentStyle={{
        alignItems: 'center',
        gap: theme.spacing.xl,
        paddingTop: theme.spacing.xxl,
      }}
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
      <WorkoutXp xp={xp} />
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
      <RecapCard workoutId={workout.id} disabled={workout.pending.length > 0} />
      <WorkoutTiming workout={workout} />
      <WorkoutEnergy workout={workout} />
      <View style={{ width: '100%', maxWidth: theme.sizes.summaryWidth }}>
        <WorkoutCalendarAction workout={workout} />
      </View>

      <WorkoutHrRecovery workout={workout} />
      <NextPrescription />
      <Stack style={{ width: '100%', maxWidth: theme.sizes.summaryWidth }}>
        {openCoach && (
          <AppButton
            title="Ask AI Coach"
            icon="coach"
            variant="primary"
            onPress={openCoach}
          />
        )}
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
          <AppButton
            title="Done"
            variant="surface"
            onPress={closeWorkout}
            style={{ flex: 1 }}
          />
        </Stack>
      </Stack>
    </PageLayout>
  );
}
