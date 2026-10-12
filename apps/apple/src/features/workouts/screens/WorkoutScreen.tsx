import { useState } from 'react';
import { View } from 'react-native';
import {
  Carousel,
  HubCard,
  IconButton,
  Notice,
  PageLayout,
  StateCard,
} from '../../../shared/ui';
import { useTheme } from '../../../shared/theme/ThemeProvider';
import { useWorkoutContext } from '../WorkoutProvider';
import { useWorkoutJournal } from '../logging/WorkoutJournalProvider';
import { SessionSelectionCard } from '../components/SessionSelectionCard';
import { TrainingSyncNotice } from '../components/TrainingSyncNotice';
import { useTrainingSync } from '../data/WorkoutDataProvider';

export function WorkoutScreen({
  openSettings,
  openWorkout,
  openSession,
  openPrograms,
  openCardio,
}: {
  openSettings: () => void;
  openWorkout: (id: string) => void;
  openSession: (id: string) => void;
  openPrograms: () => void;
  openCardio: () => void;
}) {
  const workout = useWorkoutContext();
  const journal = useWorkoutJournal();
  const sync = useTrainingSync();
  const { theme } = useTheme();
  const { catalog, refresh, refreshingManually, notice, timezone } = workout;
  const sessions = catalog?.program?.sessions ?? [];
  const [selectedId, setSelectedId] = useState('');
  const active = journal.data.workouts.find((workout) => workout.status === 'active');
  const visibleSessionId =
    sessions.find((session) => session.id === selectedId)?.id ??
    sessions.find((session) => session.id === active?.sessionId)?.id ??
    sessions.find((session) => session.id === catalog?.recommendation.sessionId)?.id ??
    sessions[0]?.id ??
    '';
  const inset = { marginHorizontal: theme.spacing.lg };
  return (
    <PageLayout
      title="Workout"
      subtitle="Choose a session to start"
      actions={<IconButton icon="program" label="Program" onPress={openPrograms} />}
    >
      {catalog && sessions.length > 0 ? (
        <Carousel
          items={sessions}
          lazy
          selectedId={visibleSessionId}
          onSelect={setSelectedId}
          label={(session) => `Session ${session.position + 1}: ${session.name}`}
          renderItem={(session) => (
            <SessionSelectionCard
              session={session}
              catalog={catalog}
              timezone={timezone}
              openWorkout={openWorkout}
              openSession={openSession}
            />
          )}
        />
      ) : (
        <View style={[{ flex: 1, justifyContent: 'center' }, inset]}>
          {!workout.signedIn ? (
            <StateCard
              title={workout.accountLoading ? 'Checking your account' : 'Connect your account'}
              message={
                workout.accountLoading
                  ? 'Loading your saved sign-in…'
                  : 'Sign in to load your program and sessions.'
              }
              loading={workout.accountLoading}
              action={workout.accountLoading ? undefined : 'Account & settings'}
              onAction={openSettings}
            />
          ) : !catalog ? (
            <StateCard
              title={
                workout.status === 'loading'
                  ? 'Loading your program'
                  : workout.status === 'unauthorized'
                    ? 'Check your account'
                    : 'Program unavailable'
              }
              message={notice ?? 'Fetching your program and sessions…'}
              loading={workout.status === 'loading' || refreshingManually}
              action={
                workout.status === 'loading'
                  ? undefined
                  : workout.status === 'unauthorized'
                    ? 'Account & settings'
                    : 'Retry'
              }
              onAction={workout.status === 'unauthorized' ? openSettings : refresh}
            />
          ) : (
            <StateCard
              title="No program yet"
              message="Create one to get a session to start."
              action="Create a program"
              onAction={openPrograms}
              loading={refreshingManually}
            />
          )}
        </View>
      )}
      {(sync.operations.some((operation) => operation.kind.startsWith('program_')) ||
        (!sync.ready && !!sync.error)) && (
        <View style={inset}>
          <TrainingSyncNotice programsOnly />
        </View>
      )}
      {catalog && notice && (
        <View style={inset}>
          <Notice title="Using saved data" message={notice} />
        </View>
      )}
      <View style={inset}>
        <HubCard
          title="Cardio Hub"
          subtitle="Run · Walk · Log anything"
          icon="cardio"
          tone="recovery"
          onPress={openCardio}
        />
      </View>
    </PageLayout>
  );
}
