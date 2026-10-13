import { useState } from 'react';
import { todayInTz } from '@trainingai/shared/date-utils';
import {
  AppButton,
  AppText,
  Badge,
  IconButton,
  Notice,
  Sheet,
  Stack,
  StateCard,
} from '../../../shared/ui';
import { useWorkoutContext } from '../WorkoutProvider';
import { useWorkoutJournal } from '../logging/WorkoutJournalProvider';
import { ExercisePreviewCard } from '../components/ExercisePreviewCard';
import { StartWorkoutCard } from '../components/StartWorkoutCard';
import { SessionExerciseList } from '../components/SessionExerciseList';
import { WorkoutLayout } from '../components/WorkoutLayout';
import { PrescriptionControls } from '../components/PrescriptionControls';
import { ExerciseHistory } from '../components/ExerciseHistory';
import { useSessionPreparation } from '../data/useSessionPreparation';
import { useWorkoutResource } from '../data/WorkoutDataProvider';
import { injurySpec } from '../data/models';
import { activeInjuredMuscles } from '@trainingai/shared/workout/injury-context';
import { normalizeMuscle } from '@trainingai/shared/muscles';

export function SessionScreen({
  sessionId,
  openSettings,
  openWorkout,
  closeSession,
  initialFullOverride = false,
}: {
  sessionId: string | null;
  openSettings: () => void;
  openWorkout: (id: string) => void;
  closeSession: () => void;
  initialFullOverride?: boolean;
}) {
  const workout = useWorkoutContext();
  const journal = useWorkoutJournal();
  const injuries = useWorkoutResource(injurySpec);
  const injuredMuscles = activeInjuredMuscles(injuries.data ?? []).map(normalizeMuscle);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [historyName, setHistoryName] = useState<string | null>(null);
  const original = workout.catalog?.program?.sessions.find(
    (session) => session.id === sessionId,
  );
  const program = workout.catalog?.program;
  const preparation = useSessionPreparation(
    original,
    program?.id,
    program?.phaseMode === 'ai_dynamic',
    initialFullOverride,
  );
  const session = preparation.session;
  const selected = session?.exercises.find((exercise) => exercise.id === selectedId);
  const today = todayInTz(workout.timezone);
  const active = journal.data.workouts.some((workout) => workout.status === 'active');
  const done =
    session?.exercises
      .filter((exercise) => exercise.loggedDate === today)
      .map((exercise) => exercise.id) ?? [];
  const allDone =
    !!session?.exercises.length && done.length === session.exercises.length && !active;
  const date = new Intl.DateTimeFormat('en-AU', {
    timeZone: workout.timezone,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(new Date());
  return (
    <WorkoutLayout
      title={session?.name ?? 'Workout'}
      subtitle={date}
      detail={session?.phaseDetail ?? session?.phase ?? undefined}
      onBack={closeSession}
      backLabel="Back to sessions"
      actions={
        <IconButton
          icon="refresh"
          label="Refresh workout data"
          onPress={workout.signedIn ? preparation.refresh : undefined}
          busy={preparation.current.refreshing || preparation.action.busy}
        />
      }
      footer={
        session &&
        program &&
        (allDone ? (
          <AppText variant="label" tone="brand" style={{ textAlign: 'center' }}>
            ✓ Done for today
          </AppText>
        ) : (
          <StartWorkoutCard
            session={session}
            programId={program.id}
            openWorkout={openWorkout}
            inline
            countdown
            options={preparation.options}
            disabled={preparation.action.busy || !!preparation.parseError}
          />
        ))
      }
    >
      {!workout.signedIn ? (
        <StateCard
          title="Connect your account"
          message="Sign in to load this session."
          action="Account & settings"
          onAction={openSettings}
        />
      ) : !session ? (
        <StateCard
          title="Session unavailable"
          message="Refresh your program or return to sessions."
          action="Refresh"
          onAction={workout.refresh}
          loading={workout.refreshingManually}
        />
      ) : (
        <>
          {(workout.source === 'saved' || preparation.current.saved) && (
            <Badge label="Saved session" />
          )}
          {workout.notice && <Notice title="Program update" message={workout.notice} />}
          {preparation.current.error && (
            <Notice title="Session update" message={preparation.current.error} />
          )}
          {injuries.error && <Notice title="Injury records" message={injuries.error} />}
          {program?.phaseMode === 'ai_dynamic' && (
            <PrescriptionControls preparation={preparation} />
          )}
          {session.prescriptionPending && (
            <Notice
              title="Preparing your workout"
              message="The current prescription is still being prepared. Starting checks the backend again."
            />
          )}
          <Stack direction="row" justify="space-between">
            <AppText variant="eyebrow" tone="muted">
              Today's exercises
            </AppText>
            {session.durationMinutes !== null && (
              <AppText variant="caption" tone="muted">
                ~{Math.round(session.durationMinutes)} min
              </AppText>
            )}
          </Stack>
          <SessionExerciseList
            exercises={session.exercises}
            completedIds={done}
            injuredMuscles={injuredMuscles}
            onSelect={(exercise) => setSelectedId(exercise.id)}
          />
          <Sheet
            visible={!!selected}
            title={selected?.name ?? 'Exercise'}
            onClose={() => setSelectedId(null)}
          >
            {selected && (
              <>
                <ExercisePreviewCard
                  exercise={selected}
                  position={session.exercises.indexOf(selected) + 1}
                />
                {[
                  ...selected.muscles,
                  ...(selected.mainMuscles ?? []),
                  ...(selected.secondaryMuscles ?? []),
                ].some((muscle) => injuredMuscles.includes(normalizeMuscle(muscle))) && (
                  <Notice
                    title="Recorded injury"
                    message="This exercise involves an injured muscle. You can choose a safe alternative from its preparation screen."
                  />
                )}
                {!!selected.preDeloadStyle?.length && (
                  <Stack>
                    <AppText variant="caption" tone="muted">
                      {selected.deloaded
                        ? 'A safety deload is applied to this exercise.'
                        : 'Full loads selected for this exercise.'}
                    </AppText>
                  </Stack>
                )}
                {!!selected.preDeloadStyle?.length && (
                  <AppButton
                    variant="secondary"
                    title={
                      selected.deloaded
                        ? 'Use full loads for this exercise'
                        : 'Restore deload loads'
                    }
                    onPress={() => preparation.toggleRevert(selected.id)}
                  />
                )}
                <StartWorkoutCard
                  session={session}
                  programId={program!.id}
                  openWorkout={(id) => {
                    setSelectedId(null);
                    openWorkout(id);
                  }}
                  inline
                  launchExerciseId={selected.id}
                  actionLabel={
                    done.includes(selected.id) ? 'Re-log this exercise' : 'Start Exercise'
                  }
                  options={preparation.options}
                  disabled={preparation.action.busy || !!preparation.parseError}
                />
                <AppButton
                  title="Exercise history"
                  variant="surface"
                  onPress={() => setHistoryName(selected.name)}
                />
              </>
            )}
          </Sheet>
          <Sheet
            visible={historyName !== null}
            title={historyName ?? 'Exercise history'}
            onClose={() => setHistoryName(null)}
          >
            {historyName && <ExerciseHistory name={historyName} />}
          </Sheet>
        </>
      )}
    </WorkoutLayout>
  );
}
