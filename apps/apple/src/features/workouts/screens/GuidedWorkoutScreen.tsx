import { useState, type ReactNode } from 'react';
import { View } from 'react-native';
import { calc1RM, displayOneRm } from '@trainingai/shared/1rm';
import {
  AppButton,
  AppText,
  Badge,
  Card,
  ConfirmationCard,
  IconButton,
  NumericStepper,
  Sheet,
  Stack,
} from '../../../shared/ui';
import { useTheme } from '../../../shared/theme/ThemeProvider';
import { useWorkoutJournal } from '../logging/WorkoutJournalProvider';
import { workoutFlow } from '../logging/flow';
import { recordedSets, type WorkoutRecord } from '../logging/workout';
import { SetEntry, SetActions } from '../components/SetEntry';
import { RestCard, SessionTimer, SetClock } from '../components/WorkoutClocks';
import { WorkoutSaveNotice } from '../components/WorkoutSaveNotice';
import { ExerciseReady } from '../components/ExerciseReady';
import { LoadSuggestion } from '../components/LoadSuggestion';
import { ExerciseSummary } from '../components/ExerciseSummary';
import { exerciseResult } from '../logging/summary';
import { WarmupContent } from '../components/WarmupContent';
import { WorkoutLayout } from '../components/WorkoutLayout';
import { SetRecapGrid } from '../components/SetRecapGrid';
import { WorkoutSessionHub } from '../components/WorkoutSessionHub';
import { InjuryControls } from '../components/InjuryControls';

export function GuidedWorkoutScreen({
  workout,
  closeWorkout,
}: {
  workout: WorkoutRecord;
  closeWorkout: () => void;
}) {
  const journal = useWorkoutJournal();
  const controller = journal.controller!;
  const { theme } = useTheme();
  const [confirmation, setConfirmation] = useState<'finish' | 'discard' | 'leave' | 'skip' | null>(
    null,
  );
  const [options, setOptions] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [calculator, setCalculator] = useState(false);
  const [calcWeight, setCalcWeight] = useState('60');
  const [calcReps, setCalcReps] = useState('8');
  const flow = workoutFlow(workout);
  const index = workout.exercises.findIndex((exercise) => exercise.id === flow.exerciseId);
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
  const resting =
    flow.stage === 'exercise' &&
    !!workout.rest &&
    !workout.runningSet &&
    exercise.sets.some((set) => set.startedAt !== null || set.completedAt !== null);
  const ready =
    flow.stage === 'exercise' &&
    setIndex === 0 &&
    !workout.runningSet &&
    !exercise.sets.some((set) => set.startedAt !== null || set.completedAt !== null);
  const count = recordedSets(workout).length;
  const nextExercise = workout.exercises
    .slice(index + 1)
    .find((exercise) => !exercise.retired && !exercise.relogOf);
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
  async function confirm() {
    let saved = false;
    if (confirmation === 'discard') {
      saved = await controller.discard(workout.id);
      if (saved) {
        closeWorkout();
      }
    } else if (confirmation === 'finish') {
      saved = await controller.finish(workout.id);
    } else if (confirmation === 'skip') {
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
    if (saved) {
      setConfirmation(null);
    }
  }
  const action =
    flow.stage === 'summary' ? (
      <AppButton
        title="Next Exercise →"
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
          onPress={() => setConfirmation('skip')}
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
        onLeave={() => setConfirmation('leave')}
        onFinish={() => {
          void controller.finish(workout.id);
        }}
        onOptions={() => setOptions(true)}
        onMinimize={closeWorkout}
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
        onBack={
          flow.stage === 'summary'
            ? () => {
                void next();
              }
            : flow.stage === 'warmup' || ready
              ? () => {
                  void controller.showSession(workout.id);
                }
              : () => setConfirmation('leave')
        }
        backIcon={flow.stage === 'summary' ? 'forward' : 'back'}
        backLabel={flow.stage === 'summary' ? 'Continue to next exercise' : 'Back to session'}
        actions={
          <Stack direction="row" gap="xs">
            <IconButton icon="down" label="Minimize workout" onPress={closeWorkout} />
            {flow.stage === 'exercise' ? (
              <IconButton
                icon="calculator"
                label="1RM calculator"
                onPress={() => {
                  setCalcWeight(set?.weight ?? '60');
                  setCalcReps(set?.reps ?? '8');
                  setCalculator(true);
                }}
              />
            ) : null}
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
        {workout.fromSavedPlan && <Badge label="Saved session" />}
        {flow.stage === 'warmup' ? (
          <WarmupContent workout={workout} />
        ) : flow.stage === 'summary' ? (
          <ExerciseSummary workout={workout} exercise={exercise} next={nextExercise} />
        ) : ready && set ? (
          <>
            <Stack direction="row" justify="space-between">
              <AppText variant="eyebrow" tone="muted">
                Exercise {visibleIndex + 1} of {visibleExercises.length}
              </AppText>
              <SessionTimer workout={workout} />
            </Stack>
            <ExerciseReady
              workout={workout}
              exercise={exercise}
              set={set}
              onSkip={() => setConfirmation('skip')}
            />
          </>
        ) : (
          <>
            <View>
              <AppText variant="pageTitle">{exercise.name}</AppText>
              {exercise.lastDate && (
                <AppText variant="micro" tone="muted">
                  Last: {exercise.lastReps.join(', ')} reps · {exercise.lastDate}
                </AppText>
              )}
            </View>
            <InjuryControls
              workout={workout}
              exercise={exercise}
              compact
              onSkip={() => setConfirmation('skip')}
            />
            <SetRecapGrid
              exercise={exercise}
              currentId={set?.id}
              running={!!workout.runningSet}
              onEdit={setEditing}
            />
            {set && <LoadSuggestion workout={workout} exercise={exercise} set={set} />}
            <View style={{ flex: 1, justifyContent: 'center', gap: theme.spacing.md }}>
              {resting ? (
                <>
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
                  {exercise.exerciseType !== 'bodyweight' &&
                    exerciseResult(workout, exercise).estimate !== null && (
                      <AppText variant="caption" tone="brand" style={{ textAlign: 'center' }}>
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
                <Card tone="brand">
                  <SetEntry
                    workout={workout}
                    exercise={exercise}
                    set={set}
                    index={exercise.sets.indexOf(set)}
                  />
                  {set.startedAt !== null && <SetClock startedAt={set.startedAt} />}
                </Card>
              ) : null}
            </View>
          </>
        )}
      </WorkoutLayout>
    );
  }
  return (
    <>
      {screen}
      <Sheet
        visible={confirmation !== null}
        title={
          confirmation === 'skip'
            ? 'Skip this exercise?'
            : confirmation === 'leave'
              ? 'Leave this exercise?'
              : confirmation === 'discard'
                ? 'Discard workout?'
                : 'Finish workout?'
        }
        onClose={() => setConfirmation(null)}
      >
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
          onConfirm={() => {
            void confirm();
          }}
          onCancel={() => setConfirmation(null)}
        />
      </Sheet>
      <Sheet visible={options} title="Workout options" onClose={() => setOptions(false)}>
        <AppButton
          title="Finish early"
          disabled={count === 0 || !!workout.runningSet}
          onPress={() => {
            setOptions(false);
            setConfirmation('finish');
          }}
        />
        <AppButton
          title="Discard workout"
          variant="danger"
          onPress={() => {
            setOptions(false);
            setConfirmation('discard');
          }}
        />
      </Sheet>
      <Sheet
        visible={!!editSet}
        title={`Edit set ${exercise.sets.findIndex((set) => set.id === editing) + 1}`}
        onClose={() => setEditing(null)}
      >
        {editSet && (
          <SetEntry
            workout={workout}
            exercise={exercise}
            set={editSet}
            index={exercise.sets.indexOf(editSet)}
          />
        )}
      </Sheet>
      <Sheet visible={calculator} title="1RM calculator" onClose={() => setCalculator(false)}>
        <NumericStepper
          label="Weight (kg)"
          value={calcWeight}
          onChange={setCalcWeight}
          max={500}
          step={2.5}
        />
        <NumericStepper label="Reps" value={calcReps} onChange={setCalcReps} min={1} max={30} />
        <AppText variant="heading" tone="brand">
          Estimated 1RM ·{' '}
          {Number(calcWeight) > 0 && Number(calcReps) > 0
            ? displayOneRm(calc1RM(Number(calcWeight), Number(calcReps)), 'weighted').text
            : '—'}
        </AppText>
      </Sheet>
    </>
  );
}
