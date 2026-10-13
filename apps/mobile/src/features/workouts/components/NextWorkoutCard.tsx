import { AppButton, AppText, Badge, Card, Notice, Stack, StateCard } from '../../../shared/ui';
import { useWorkoutContext } from '../WorkoutProvider';
import type { SessionPreview } from '../catalog';
import { StartWorkoutCard } from './StartWorkoutCard';

export function sessionSummary(session: SessionPreview) {
  const count = session.exercises.length;
  return `${count} ${count === 1 ? 'exercise' : 'exercises'}${session.durationMinutes === null ? '' : ` · ~${Math.round(session.durationMinutes)} min`}`;
}

export function NextWorkoutCard({
  openSession,
  openSettings,
  openWorkout,
}: {
  openSession: (id: string) => void;
  openSettings: () => void;
  openWorkout: (id: string) => void;
}) {
  const workout = useWorkoutContext();
  const { catalog, source, notice, refreshingManually, refresh } = workout;
  if (!workout.signedIn) {
    return (
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
    );
  }
  if (!catalog) {
    if (workout.status === 'loading') {
      return (
        <StateCard
          title="Loading your program"
          message="Fetching your program and next session…"
          loading
        />
      );
    }
    return (
      <StateCard
        title={workout.status === 'unauthorized' ? 'Check your account' : 'Program unavailable'}
        message={notice ?? 'Could not load your program.'}
        error
        action={workout.status === 'unauthorized' ? 'Account & settings' : 'Retry'}
        onAction={workout.status === 'unauthorized' ? openSettings : refresh}
        loading={refreshingManually}
      />
    );
  }
  const session = catalog.program?.sessions.find(
    (value) => value.id === catalog.recommendation.sessionId,
  );
  return (
    <>
      <Card tone="brand">
        <Stack direction="row" justify="space-between" align="center" wrap>
          <AppText variant="eyebrow" tone="brand">
            {source === 'saved' ? 'LAST SAVED RECOMMENDATION' : 'NEXT WORKOUT'}
          </AppText>
          <Badge label={source === 'saved' ? 'Saved on device' : 'Up to date'} tone="brand" />
        </Stack>
        <AppText variant="heading">
          {!catalog.program
            ? 'No active program'
            : catalog.recommendation.isRestDay
              ? 'Rest day'
              : (session?.name ?? 'Choose a session')}
        </AppText>
        <AppText tone="muted">
          {!catalog.program
            ? 'Create or activate a program in the existing app, then refresh here.'
            : catalog.recommendation.reason}
        </AppText>
        {session && (
          <>
            {catalog.recommendation.isRestDay && (
              <AppText variant="label">Next session: {session.name}</AppText>
            )}
            <AppText variant="caption" tone="muted">
              {sessionSummary(session)}
            </AppText>
            <StartWorkoutCard
              session={session}
              programId={catalog.program!.id}
              openWorkout={openWorkout}
              inline
            />
            <AppButton
              title="Preview session"
              variant="ghost"
              onPress={() => openSession(session.id)}
            />
          </>
        )}
        <AppButton
          title={refreshingManually ? 'Refreshing…' : notice ? 'Retry refresh' : 'Refresh program'}
          variant="ghost"
          busy={refreshingManually}
          onPress={refresh}
        />
      </Card>
      {notice && (
        <Notice
          title={source === 'saved' ? 'Using saved data' : 'Program update'}
          message={notice}
        />
      )}
    </>
  );
}
