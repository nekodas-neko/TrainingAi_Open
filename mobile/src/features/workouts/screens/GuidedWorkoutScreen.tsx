import { useMemo, useRef, useState, type ReactNode } from 'react';
import { View } from 'react-native';
import {
  barShareOfOneRm,
  calc1RM,
  displayOneRm,
  oneRmLabel,
} from '@trainingai/shared/1rm';
import {
  AppButton,
  AppText,
  Badge,
  Card,
  ConfirmationCard,
  IconButton,
  MuscleMap,
  NumericStepper,
  Sheet,
  Stack,
} from '../../../shared/ui';
import { useTheme } from '../../../shared/theme/ThemeProvider';
import { useWorkoutJournal } from '../logging/WorkoutJournalProvider';
import { workoutFlow } from '../logging/flow';
import { recordedSets, type WorkoutRecord } from '../logging/workout';
import { SetEntry, SetActions } from '../components/SetEntry';
import { PausedBanner, RestCard, canPauseWorkout } from '../components/WorkoutClocks';
import { PipHeartRate } from '../components/PipHeartRate';
import { LiveHrCard } from '../components/LiveHrCard';
import { useWorkoutPip } from '../pip/usePictureInPicture';
import { usePipSourceRect } from '../pip/usePipSourceRect';
import { useWorkoutResource } from '../data/WorkoutDataProvider';
import { hrProfileSpec } from '../../health/data/models';
import { WorkoutSaveNotice } from '../components/WorkoutSaveNotice';
import { ExerciseReady } from '../components/ExerciseReady';
import { LoadSuggestion } from '../components/LoadSuggestion';
import { ExerciseSummary } from '../components/ExerciseSummary';
import { exerciseResult } from '../logging/summary';
import { WarmupContent } from '../components/WarmupContent';
import { WorkoutLayout } from '../components/WorkoutLayout';
import { SetRecapGrid } from '../components/SetRecapGrid';
import { WorkoutSessionHub } from '../components/WorkoutSessionHub';
import { WorkoutTimerControls } from '../components/WorkoutTimerOptions';
import { ExerciseDetails } from '../components/ExerciseDetails';
import { ExerciseHistory } from '../components/ExerciseHistory';
import { InjuryControls } from '../components/InjuryControls';

type ConfirmationKind = 'finish' | 'discard' | 'leave' | 'skip';
type WorkoutPanel =
  | ConfirmationKind
  | 'options'
  | 'timers'
  | 'calculator'
  | 'edit'
  | 'muscles'
  | 'details'
  | 'history';

export function GuidedWorkoutScreen({
  workout,
  closeWorkout,
}: {
  workout: WorkoutRecord;
  closeWorkout: () => void;
}) {
  const journal = useWorkoutJournal();
  const controller = journal.controller!;
  const pip = useWorkoutPip(workout, controller);
  const setSource = usePipSourceRect();
  const { theme } = useTheme();
  // Read once for the screen, not per rest, as the current app does for its Live HR card (RV-64).
  const hrProfile = useWorkoutResource(hrProfileSpec).data;
  const zoneProfile =
    hrProfile?.maxHr != null && hrProfile.restingHr != null
      ? { maxHr: hrProfile.maxHr, restingHr: hrProfile.restingHr }
      : null;
  const [panel, setPanel] = useState<WorkoutPanel | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const lastPanel = useRef<WorkoutPanel>('options');
  const pendingNavigation = useRef<(() => void) | null>(null);
  if (panel !== null) {
    lastPanel.current = panel;
  }
  const shownPanel = panel ?? lastPanel.current;
  const confirmation = ['finish', 'discard', 'leave', 'skip'].includes(shownPanel)
    ? (shownPanel as ConfirmationKind)
    : null;
  function openEdit(id: string) {
    setEditing(id);
    setPanel('edit');
  }
  function afterDismiss(action: () => void) {
    if (pendingNavigation.current) {
      return;
    }
    pendingNavigation.current = action;
    setPanel(null);
  }
  const [calcWeight, setCalcWeight] = useState('60');
  const [calcReps, setCalcReps] = useState('8');
  const flow = workoutFlow(workout);
  const index = workout.exercises.findIndex(
    (exercise) => exercise.id === flow.exerciseId,
  );
  const exercise = workout.exercises[index];
  const visibleExercises = workout.exercises.filter(
    (exercise) => !exercise.retired && !exercise.relogOf,
  );
  const visibleIndex = visibleExercises.findIndex(
    (item) => item.id === (exercise.relogOf ?? exercise.id),
  );
  const setIndex = exercise.sets.findIndex((set) => set.completedAt === null);
  const set = workout.runningSet
    ? exercise.sets.find((set) => set.id === workout.runningSet!.setId)
    : exercise.sets[setIndex];
  const resting = flow.stage === 'exercise' && !!workout.rest && !workout.runningSet;
  const ready =
    flow.stage === 'exercise' &&
    setIndex === 0 &&
    !workout.runningSet &&
    !workout.rest &&
    !exercise.sets.some((set) => set.startedAt !== null || set.completedAt !== null);
  const muscleAssignments = useMemo(() => {
    const sources =
      flow.stage === 'review' || flow.stage === 'warmup'
        ? workout.exercises.filter((x) => !x.retired && !x.relogOf)
        : [exercise];
    const roles = new Map<string, 'main' | 'secondary'>();
    for (const source of sources) {
      for (const muscle of source.secondaryMuscles) {
        if (!roles.has(muscle)) {
          roles.set(muscle, 'secondary');
        }
      }
      for (const muscle of source.mainMuscles.length
        ? source.mainMuscles
        : source.muscles) {
        roles.set(muscle, 'main');
      }
    }
    return [...roles].map(([muscle, role]) => ({ muscle, role }));
  }, [workout.exercises, exercise, flow.stage]);
  const count = recordedSets(workout).length;
  const nextExercise = workout.exercises
    .slice(index + 1)
    .find((exercise) => !exercise.retired && !exercise.relogOf && !exercise.skipped);
  const last = !nextExercise;
  const editSet = exercise.sets.find((set) => set.id === editing);
  async function next() {
    if (workout.soloExerciseId) {
      await controller.showSession(workout.id);
    } else if (last) {
      await controller.finish(workout.id);
    } else {
      await controller.advanceExercise(workout.id);
    }
  }
  async function confirm(decision: ConfirmationKind) {
    let saved = false;
    if (decision === 'discard') {
      saved = await controller.discard(workout.id);
      if (saved) {
        closeWorkout();
      }
    } else if (decision === 'finish') {
      saved = await controller.finish(workout.id);
    } else if (decision === 'skip') {
      saved = await controller.skipExercise(workout.id);
      if (saved && last && !workout.soloExerciseId && count > 0) {
        saved = await controller.finish(workout.id);
      }
    } else if (flow.stage === 'review') {
      closeWorkout();
      saved = true;
    } else {
      saved = await controller.showSession(workout.id);
    }
    if (!saved) {
      setPanel(decision);
    }
  }
  const paused = workout.pausedAt !== null;
  const action = paused ? (
    <AppButton
      title="Resume"
      icon="play"
      variant="warning"
      busy={journal.busy}
      onPress={() => {
        void controller.resume(workout.id);
      }}
    />
  ) : flow.stage === 'summary' ? (
      <AppButton
        title={
          workout.soloExerciseId
            ? 'Back to session'
            : last
              ? 'Complete Workout'
              : 'Next Exercise'
        }
        busy={journal.busy}
        onPress={() => {
          void next();
        }}
      />
    ) : (
      <Stack direction="row" gap="md">
        <AppButton
          title=""
          icon="skip"
          variant="surface"
          accessibilityLabel="Skip exercise"
          disabled={journal.busy}
          onPress={() => setPanel('skip')}
        />
        <View style={{ flex: 1 }}>
          {set ? (
            <SetActions
              workout={workout}
              exercise={exercise}
              set={set}
              index={exercise.sets.indexOf(set)}
            />
          ) : null}
        </View>
      </Stack>
    );
  let screen: ReactNode;
  if (flow.stage === 'review') {
    screen = (
      <WorkoutSessionHub
        workout={workout}
        onLeave={() => setPanel('leave')}
        onFinish={() => {
          void controller.finish(workout.id);
        }}
        onOptions={() => setPanel('options')}
        onMinimize={closeWorkout}
        onMuscles={() => setPanel('muscles')}
      />
    );
  } else {
    screen = (
      <WorkoutLayout
        title={
          flow.stage === 'warmup'
            ? `${workout.sessionName} — Warm Up`
            : flow.stage === 'summary'
              ? exercise.name
              : workout.sessionName
        }
        subtitle={
          flow.stage === 'summary'
            ? 'Set summary'
            : flow.stage === 'warmup'
              ? undefined
              : `${(workout.phaseDetail ?? workout.phase) ? `${workout.phaseDetail ?? workout.phase} · ` : ''}${workout.soloExerciseId ? 'Solo' : `Ex ${visibleIndex + 1}/${visibleExercises.length}`}`
        }
        workout={workout}
        ring={flow.stage === 'exercise'}
        fillBottom={flow.stage === 'exercise' && !ready && !resting}
        onBack={
          flow.stage === 'summary'
            ? () => {
                void next();
              }
            : flow.stage === 'warmup' || ready
              ? () => {
                  void controller.showSession(workout.id);
                }
              : () => setPanel('leave')
        }
        backIcon={flow.stage === 'summary' ? 'forward' : 'back'}
        backLabel={
          flow.stage === 'summary' ? 'Continue to next exercise' : 'Back to session'
        }
        titleAction={
          <IconButton
            icon="muscles"
            label="Muscles worked"
            onPress={() => setPanel('muscles')}
          />
        }
        actions={
          <Stack direction="row" gap="xs">
            <IconButton
              icon="more"
              label="Workout options"
              onPress={() => setPanel('options')}
            />
            <IconButton icon="down" label="Minimize workout" onPress={closeWorkout} />
          </Stack>
        }
        footer={
          flow.stage === 'warmup' ? (
            <AppButton
              title="Begin Exercises"
              icon="workout"
              busy={journal.busy}
              onPress={() => {
                void controller.beginExercises(workout.id);
              }}
            />
          ) : (
            action
          )
        }
      >
        <WorkoutSaveNotice />
        <PausedBanner workout={workout} />
        {workout.fromSavedPlan && <Badge label="Saved session" />}
        {flow.stage === 'warmup' ? (
          <WarmupContent workout={workout} />
        ) : flow.stage === 'summary' ? (
          <ExerciseSummary
            workout={workout}
            exercise={exercise}
            next={nextExercise}
            onEdit={openEdit}
          />
        ) : ready && set ? (
          <>
            <Stack direction="row" justify="space-between">
              <AppText variant="eyebrow" tone="muted">
                Exercise {visibleIndex + 1} of {visibleExercises.length}
              </AppText>
            </Stack>
            <ExerciseReady
              workout={workout}
              exercise={exercise}
              set={set}
              onSkip={() => setPanel('skip')}
              onDetails={() => setPanel('details')}
            />
          </>
        ) : (
          <>
            <Stack direction="row" align="center" gap="sm">
              <View style={{ flex: 1, minWidth: 0 }}>
                <AppText variant="pageTitle">{exercise.name}</AppText>
                {exercise.lastDate && (
                  <AppText variant="micro" tone="muted">
                    Last: {exercise.lastReps.join(', ')} reps · {exercise.lastDate}
                  </AppText>
                )}
                <AppText variant="caption" tone="brand">
                  {oneRmLabel(exercise.exerciseType)}:{' '}
                  {exercise.estimated1rm === null
                    ? 'Unavailable'
                    : displayOneRm(exercise.estimated1rm, exercise.exerciseType).text}
                  {exercise.exerciseType === 'weighted' &&
                  set &&
                  barShareOfOneRm(Number(set.weight), exercise.estimated1rm) !== null
                    ? ` - Load ${barShareOfOneRm(Number(set.weight), exercise.estimated1rm)}%`
                    : ''}
                </AppText>
              </View>
              <IconButton
                icon="info"
                label="Exercise details"
                onPress={() => setPanel('details')}
              />
            </Stack>
            <InjuryControls
              workout={workout}
              exercise={exercise}
              compact
              onSkip={() => setPanel('skip')}
            />
            <SetRecapGrid
              exercise={exercise}
              currentId={set?.id}
              running={!!workout.runningSet}
              onEdit={openEdit}
            />
            {set && <LoadSuggestion workout={workout} exercise={exercise} set={set} />}
            <View
              style={{
                flex: 1,
                justifyContent: resting ? 'center' : 'flex-start',
                gap: theme.spacing.md,
              }}
            >
              {resting ? (
                <>
                  <AppText variant="label" style={{ textAlign: 'center' }}>
                    Next: {exercise.name}, set {set ? exercise.sets.indexOf(set) + 1 : ''}
                  </AppText>
                  <RestCard
                    workout={workout}
                    onStartSet={
                      set
                        ? () => {
                            void controller.startSet(workout.id, exercise.id, set.id);
                          }
                        : undefined
                    }
                  />
                  <LiveHrCard sinceMs={workout.rest?.startedAt ?? null} profile={zoneProfile} />
                  {exercise.exerciseType !== 'bodyweight' &&
                    exerciseResult(workout, exercise).estimate !== null && (
                      <AppText
                        variant="caption"
                        tone="brand"
                        style={{ textAlign: 'center' }}
                      >
                        Live 1RM ·{' '}
                        {
                          displayOneRm(
                            exerciseResult(workout, exercise).estimate!,
                            exercise.exerciseType,
                          ).text
                        }
                      </AppText>
                    )}
                </>
              ) : set ? (
                <View
                  ref={setSource.ref}
                  onLayout={setSource.onLayout}
                  collapsable={false}
                  style={{ flex: 1 }}
                >
                  <Card tone="brand" style={{ flex: 1, padding: theme.spacing.md }}>
                    <SetEntry
                      fill
                      workout={workout}
                      exercise={exercise}
                      set={set}
                      index={exercise.sets.indexOf(set)}
                    />
                  </Card>
                </View>
              ) : null}
            </View>
          </>
        )}
      </WorkoutLayout>
    );
  }
  const sheetTitle = confirmation
    ? confirmation === 'skip'
      ? 'Skip this exercise?'
      : confirmation === 'leave'
        ? 'Leave this exercise?'
        : confirmation === 'discard'
          ? 'Discard workout?'
          : 'Finish workout?'
    : {
        options: 'Workout options',
        timers: 'Workout timers',
        calculator: '1RM calculator',
        edit: `Edit set ${exercise.sets.findIndex((x) => x.id === editing) + 1}`,
        muscles: 'Muscles worked',
        details: exercise.name,
        history: `${exercise.name} history`,
      }[shownPanel as Exclude<WorkoutPanel, ConfirmationKind>];
  return (
    <>
      {screen}
      <PipHeartRate reporter={pip} profile={zoneProfile} />
      <Sheet
        visible={panel !== null}
        title={sheetTitle}
        onClose={() => setPanel(null)}
        onDismiss={() => {
          const action = pendingNavigation.current;
          pendingNavigation.current = null;
          action?.();
        }}
        actions={
          !confirmation && shownPanel !== 'options' ? (
            <IconButton
              icon="back"
              label="Back to workout options"
              onPress={() => setPanel('options')}
            />
          ) : undefined
        }
      >
        {confirmation ? (
          <>
            <WorkoutSaveNotice />
            <ConfirmationCard
              title={
                confirmation === 'skip'
                  ? 'Skip this exercise?'
                  : confirmation === 'leave'
                    ? 'Return to session?'
                    : confirmation === 'discard'
                      ? 'Discard this workout?'
                      : 'Finish this workout?'
              }
              message={
                confirmation === 'discard'
                  ? 'Discard this unfinished workout? It cannot be resumed and will not upload.'
                  : confirmation === 'finish'
                    ? `${count} sets recorded. Save these sets and finish?`
                    : 'Your recorded progress stays saved on this phone.'
              }
              confirmLabel={
                confirmation === 'skip'
                  ? 'Skip'
                  : confirmation === 'leave'
                    ? 'Leave'
                    : confirmation === 'discard'
                      ? 'Discard workout'
                      : 'Save finished workout'
              }
              danger={confirmation === 'discard'}
              busy={journal.busy}
              onConfirm={() =>
                afterDismiss(() => {
                  void confirm(confirmation);
                })
              }
              onCancel={() => setPanel(null)}
            />
          </>
        ) : shownPanel === 'options' ? (
          <>
            {flow.stage !== 'review' && flow.stage !== 'warmup' && (
              <AppButton
                title="Exercise details"
                icon="info"
                variant="surface"
                onPress={() => setPanel('details')}
              />
            )}
            {canPauseWorkout(workout) && (
              <AppButton
                title={paused ? 'Resume workout' : 'Pause workout'}
                icon={paused ? 'play' : 'pause'}
                variant="surface"
                busy={journal.busy}
                onPress={() => {
                  void (paused ? controller.resume(workout.id) : controller.pause(workout.id));
                  setPanel(null);
                }}
              />
            )}
            <AppButton
              title="Timer preferences"
              variant="surface"
              onPress={() => setPanel('timers')}
            />
            <AppButton
              title="Minimise workout"
              variant="surface"
              disabled={journal.saveStatus !== 'saved' || journal.busy}
              onPress={() => afterDismiss(closeWorkout)}
            />
            <AppButton
              title="Finish early"
              disabled={count === 0 || !!workout.runningSet}
              onPress={() => setPanel('finish')}
            />
            <AppButton
              title="Discard workout"
              variant="danger"
              onPress={() => setPanel('discard')}
            />
          </>
        ) : shownPanel === 'timers' ? (
          <WorkoutTimerControls workout={workout} onClose={() => setPanel(null)} />
        ) : shownPanel === 'details' ? (
          <ExerciseDetails
            workout={workout}
            exercise={exercise}
            set={set}
            onAdjust={() => {
              if (set) {
                openEdit(set.id);
              }
            }}
            onHistory={() => setPanel('history')}
            onCalculator={() => {
              setCalcWeight(set?.weight ?? '60');
              setCalcReps(set?.reps ?? '8');
              setPanel('calculator');
            }}
          />
        ) : shownPanel === 'history' ? (
          <ExerciseHistory name={exercise.name} />
        ) : shownPanel === 'muscles' ? (
          <>
            <AppText variant="heading">
              {flow.stage === 'review' || flow.stage === 'warmup'
                ? workout.sessionName
                : exercise.name}
            </AppText>
            <View style={{ height: theme.sizes.timerRing * 2 }}>
              <MuscleMap assignments={muscleAssignments} />
            </View>
            <Stack direction="row" wrap gap="xs">
              {muscleAssignments.map((x) => (
                <Badge
                  key={x.muscle}
                  label={`${x.muscle} (${x.role === 'main' ? 'primary' : 'secondary'})`}
                  tone={x.role === 'main' ? 'brand' : 'activity'}
                />
              ))}
            </Stack>
          </>
        ) : shownPanel === 'edit' && editSet ? (
          <SetEntry
            voice={false}
            workout={workout}
            exercise={exercise}
            set={editSet}
            index={exercise.sets.indexOf(editSet)}
          />
        ) : shownPanel === 'calculator' ? (
          <>
            <NumericStepper
              label="Weight (kg)"
              value={calcWeight}
              onChange={setCalcWeight}
              max={500}
              step={2.5}
            />
            <NumericStepper
              label="Reps"
              value={calcReps}
              onChange={setCalcReps}
              min={1}
              max={30}
            />
            <AppText variant="heading" tone="brand">
              Estimated 1RM ·{' '}
              {Number(calcWeight) > 0 && Number(calcReps) > 0
                ? displayOneRm(calc1RM(Number(calcWeight), Number(calcReps)), 'weighted')
                    .text
                : '—'}
            </AppText>
          </>
        ) : null}
      </Sheet>
    </>
  );
}
