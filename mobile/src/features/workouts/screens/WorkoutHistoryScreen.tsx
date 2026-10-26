import { useState } from 'react';
import { Pressable } from 'react-native';
import { ExerciseHistory } from '../components/ExerciseHistory';
import { formatTimeOfDay } from '@trainingai/shared/date-utils';
import { toAestDay } from '@trainingai/shared/date-utils';
import {
  AppButton,
  AppText,
  Card,
  ConfirmationCard,
  IconButton,
  ListRow,
  Notice,
  NumericStepper,
  MonthCalendar,
  Sheet,
  Stack,
  StatusIndicator,
} from '../../../shared/ui';
import { loadLabel } from '../logging/preferences';
import { WorkoutLayout } from '../components/WorkoutLayout';
import { ResourceStatus } from '../components/ResourceStatus';
import { useWorkoutResource } from '../data/WorkoutDataProvider';
import { calendarSpec, daySpec, type DayExercise } from '../data/models';
import { useHistoryQueue } from '../data/HistoryQueueProvider';
import { overlayHistory } from '../data/HistoryOutbox';
import { useWorkoutContext } from '../WorkoutProvider';
import { useWorkoutJournal } from '../logging/WorkoutJournalProvider';
import { useWorkoutAction } from '../data/useWorkoutAction';
import { formatSetLoad } from '../logging/targets';

export function HistoryDay({
  date,
  embedded = false,
  compact = false,
  readOnly = false,
  sessionEnergy,
}: {
  date: string;
  embedded?: boolean;
  compact?: boolean;
  readOnly?: boolean;
  sessionEnergy?: { id: string; kcal: number; source: 'hr' | 'met' }[];
}) {
  const { timezone } = useWorkoutContext();
  const [history, setHistory] = useState<string | null>(null);
  const state = useWorkoutResource(daySpec(date));
  const queue = useHistoryQueue();
  const journal = useWorkoutJournal();
  const action = useWorkoutAction();
  const [edit, setEdit] = useState<DayExercise | null>(null);
  const [weights, setWeights] = useState<string[]>([]);
  const [reps, setReps] = useState<string[]>([]);
  const [remove, setRemove] = useState<{
    exerciseLogId?: string;
    workoutSessionId?: string;
    name: string;
  } | null>(null);
  const entries = overlayHistory(state.data?.exercises ?? [], queue.operations);
  const sessionIds = [...new Set(entries.map((entry) => entry.workoutSessionId))];
  function awaitingUpload(id: string) {
    return journal.data.workouts.some(
      (workout) => workout.id === id && workout.pending.length > 0,
    );
  }
  async function save() {
    if (!edit || !queue.queue) {
      return;
    }
    await action.run(async () => {
      if (awaitingUpload(edit.workoutSessionId)) {
        throw new Error('Upload this workout before editing its history.');
      }
      if (
        !weights.length ||
        weights.some((weight) => !weight.trim() || !Number.isFinite(Number(weight))) ||
        reps.some((rep) => !/^\d+$/.test(rep))
      ) {
        throw new Error('Enter a weight and whole-number reps for each set.');
      }
      await queue.queue!.enqueue('exercise_log_edit', date, {
        exerciseLogId: edit.exerciseLogId,
        weights: weights.map(Number),
        reps: reps.map(Number),
      });
      setEdit(null);
    }, 'Saved on phone.');
  }
  async function confirmDelete() {
    if (!remove || !queue.queue) {
      return;
    }
    await action.run(async () => {
      const sessionId =
        remove.workoutSessionId ??
        entries.find((entry) => entry.exerciseLogId === remove.exerciseLogId)?.workoutSessionId;
      if (sessionId && awaitingUpload(sessionId)) {
        throw new Error('Upload this workout before deleting its history.');
      }
      await queue.queue!.enqueue(
        remove.exerciseLogId ? 'exercise_log_delete' : 'workout_session_delete',
        date,
        remove.exerciseLogId
          ? { exerciseLogId: remove.exerciseLogId }
          : { workoutSessionId: remove.workoutSessionId },
      );
      if (remove.workoutSessionId) {
        await journal.controller?.removeCompleted(remove.workoutSessionId);
      }
      setRemove(null);
    });
  }
  return (
    <>
      <Stack direction="row" align="center" justify="space-between">
        <AppText variant="eyebrow" tone="muted">
          {compact ? 'Training' : 'Workouts'}
        </AppText>
        {embedded && (
          <StatusIndicator
            label="Workout records"
            busy={state.loading || state.refreshing || queue.syncing}
            error={state.error ?? queue.error ?? action.error}
            message={
              queue.operations.length
                ? `${queue.operations.length} workout changes saved on phone.`
                : null
            }
            onRetry={() => {
              state.refresh();
              void queue.queue?.sync();
            }}
          />
        )}
        {!compact && (
          <IconButton
            icon="refresh"
            label="Refresh day"
            busy={state.refreshing}
            onPress={state.refresh}
          />
        )}
      </Stack>
      {!embedded && <ResourceStatus state={state} refresh={state.refresh} />}
      {!embedded && queue.error && <Notice title="History upload" message={queue.error} />}
      {!embedded && queue.operations.length > 0 && (
        <AppButton
          title={queue.syncing ? 'Uploading changes…' : 'Retry history upload'}
          variant="ghost"
          busy={queue.syncing}
          onPress={() => {
            void queue.queue?.sync();
          }}
        />
      )}
      {!embedded && action.error && <Notice title="History change" message={action.error} />}
      {sessionIds.map((id) => (
        <Card key={id}>
          <Stack direction="row" justify="space-between">
            <AppText variant="heading">
              {entries.find((entry) => entry.workoutSessionId === id)?.sessionName}
            </AppText>
            {readOnly?null:compact ? (
              <IconButton
                icon="delete"
                label="Delete workout"
                disabled={!queue.ready || awaitingUpload(id)}
                onPress={() =>
                  setRemove({
                    workoutSessionId: id,
                    name:
                      entries.find((e) => e.workoutSessionId === id)?.sessionName ?? 'workout',
                  })
                }
              />
            ) : (
              <AppButton
                title="Delete workout"
                variant="danger"
                disabled={!queue.ready || awaitingUpload(id)}
                onPress={() =>
                  setRemove({
                    workoutSessionId: id,
                    name:
                      entries.find((entry) => entry.workoutSessionId === id)?.sessionName ??
                      'workout',
                  })
                }
              />
            )}
          </Stack>
          {state.data?.workoutDurationsById?.[id] && (
            <AppText variant="caption" tone="muted">
              {compact
                ? `${formatTimeOfDay(state.data.workoutDurationsById[id]!.start, timezone)} → ${formatTimeOfDay(state.data.workoutDurationsById[id]!.end, timezone)} · `
                : ''}
              {Math.round(state.data.workoutDurationsById[id]!.minutes)} min
            </AppText>
          )}
          {entries
            .filter((entry) => entry.workoutSessionId === id)
            .map((entry) =>
              compact ? (
                <Stack key={entry.exerciseLogId} direction="row" align="center" gap="xs">
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={entry.name + ' history'}
                    onPress={() => setHistory(entry.name)}
                    style={{ flex: 1 }}
                  >
                    <AppText variant="caption">{entry.name}</AppText>
                  </Pressable>
                  <AppText variant="micro" tone="muted">
                    {entry.sets ?? entry.reps.length} × {entry.reps[0] ?? '—'}
                  </AppText>
                  <AppText variant="micro">
                    {entry.exerciseType === 'bodyweight'
                      ? entry.weightKg
                        ? `BW +${loadLabel(entry.weightKg)}`
                        : 'BW'
                      : entry.weightKg == null
                        ? '—'
                        : loadLabel(entry.weightKg)}
                  </AppText>
                  {!readOnly && <>
                  <IconButton
                    icon="edit"
                    label={'Edit ' + entry.name}
                    disabled={!queue.ready || awaitingUpload(id)}
                    onPress={() => {
                      setEdit(entry);
                      setReps(entry.reps.map(String));
                      setWeights(
                        entry.reps.map((_, i) =>
                          entry.setWeights[i] === undefined ? '' : String(entry.setWeights[i]),
                        ),
                      );
                    }}
                  />
                  <IconButton
                    icon="delete"
                    label={'Delete ' + entry.name}
                    disabled={!queue.ready || awaitingUpload(id)}
                    onPress={() =>
                      setRemove({ exerciseLogId: entry.exerciseLogId, name: entry.name })
                    }
                  />
                  </>}
                </Stack>
              ) : (
                <Stack key={entry.exerciseLogId}>
                  <AppText variant="label">{entry.name}</AppText>
                  {entry.reps.map((rep, index) => (
                    <AppText key={index} variant="caption" tone="muted">
                      Set {index + 1} ·{' '}
                      {entry.setWeights[index] === undefined
                        ? `${rep} reps · load unavailable`
                        : formatSetLoad(
                            {
                              exerciseType:
                                entry.exerciseType === 'bodyweight' ? 'bodyweight' : 'weighted',
                            },
                            { weight: String(entry.setWeights[index]), reps: String(rep) },
                          )}
                    </AppText>
                  ))}
                  <Stack direction="row">
                    <AppButton
                      title="Edit"
                      variant="surface"
                      disabled={!queue.ready || awaitingUpload(id)}
                      onPress={() => {
                        setEdit(entry);
                        setReps(entry.reps.map(String));
                        setWeights(
                          entry.reps.map((_, index) =>
                            entry.setWeights[index] === undefined
                              ? ''
                              : String(entry.setWeights[index]),
                          ),
                        );
                      }}
                    />
                    <AppButton
                      title="Delete exercise"
                      variant="danger"
                      disabled={!queue.ready || awaitingUpload(id)}
                      onPress={() =>
                        setRemove({ exerciseLogId: entry.exerciseLogId, name: entry.name })
                      }
                    />
                  </Stack>
                </Stack>
              ),
            )}
          {compact && (
            <Stack direction="row" justify="space-between">
              <AppText variant="micro" tone="muted">
                {Math.round(
                  entries
                    .filter((e) => e.workoutSessionId === id)
                    .reduce(
                      (n, e) =>
                        n + e.setWeights.reduce((sum, w, i) => sum + w * (e.reps[i] ?? 0), 0),
                      0,
                    ),
                ).toLocaleString()}{' '}
                kg volume
              </AppText>
              <AppText variant="micro" tone="muted">
                {entries.filter((e) => e.workoutSessionId === id).length} exercises
              </AppText>
              <AppText variant="micro" tone="muted">
                {entries
                  .filter((e) => e.workoutSessionId === id)
                  .reduce((n, e) => n + e.reps.length, 0)}{' '}
                sets
              </AppText>
              {sessionEnergy?.find((e) => e.id === id && e.kcal > 0) && (
                <AppText variant="micro" tone="muted">
                  ~{Math.round(sessionEnergy.find((e) => e.id === id)!.kcal)} est.{' '}
                  {sessionEnergy.find((e) => e.id === id)!.source.toUpperCase()} kcal
                </AppText>
              )}
            </Stack>
          )}
        </Card>
      ))}
      {state.data && entries.length === 0 && (
        <AppText tone="muted">No workouts recorded for this day.</AppText>
      )}
      <Sheet
        visible={history !== null}
        title={history ?? 'Exercise history'}
        onClose={() => setHistory(null)}
      >
        {history && <ExerciseHistory name={history} />}
      </Sheet>
      <Sheet
        visible={edit !== null}
        title={`Edit ${edit?.name ?? 'exercise'}`}
        onClose={() => setEdit(null)}
      >
        {action.error && <Notice title="History change" message={action.error} />}
        {weights.map((weight, index) => (
          <Card key={index}>
            <AppText variant="label">Set {index + 1}</AppText>
            <Stack direction="row">
              <NumericStepper
                label="Weight (kg)"
                value={weight}
                min={edit?.exerciseType === 'bodyweight' ? -100 : 0}
                max={500}
                step={1.25}
                onChange={(weight) =>
                  setWeights(weights.map((value, at) => (at === index ? weight : value)))
                }
              />
              <NumericStepper
                label="Reps"
                value={reps[index]}
                max={100}
                onChange={(rep) =>
                  setReps(reps.map((value, at) => (at === index ? rep : value)))
                }
              />
            </Stack>
          </Card>
        ))}
        <AppButton
          title="Save changes"
          busy={action.busy}
          onPress={() => {
            void save();
          }}
        />
      </Sheet>
      <Sheet visible={remove !== null} title="Delete history" onClose={() => setRemove(null)}>
        {action.error && <Notice title="History change" message={action.error} />}
        {remove && (
          <ConfirmationCard
            title={`Delete ${remove.name}?`}
            message="This removes the selected history and recalculates affected records."
            confirmLabel="Delete"
            cancelLabel="Cancel"
            danger
            busy={action.busy}
            onConfirm={() => {
              void confirmDelete();
            }}
            onCancel={() => setRemove(null)}
          />
        )}
      </Sheet>
    </>
  );
}
export function WorkoutHistoryScreen({
  onBack,
  openWorkout,
}: {
  onBack: () => void;
  openWorkout: (id: string) => void;
}) {
  const { timezone } = useWorkoutContext();
  const journal = useWorkoutJournal();
  const today = toAestDay(new Date(), timezone);
  const [month, setMonth] = useState(today.slice(0, 7));
  const [selected, setSelected] = useState<string | null>(null);
  const [year, number] = month.split('-').map(Number);
  const state = useWorkoutResource(calendarSpec(year, number));
  const local = journal.data.workouts.filter(
    (workout) => workout.status === 'completed' && workout.date.startsWith(month),
  );
  const markers: Record<string, string[]> = {};
  for (const [date, names] of Object.entries(state.data?.trainedDays ?? {})) {
    markers[date.replace(/\//g, '-')] = names;
  }
  for (const workout of local) {
    markers[workout.date] = [
      ...new Set([...(markers[workout.date] ?? []), workout.sessionName]),
    ];
  }
  return (
    <WorkoutLayout
      title="Workout history"
      onBack={onBack}
      actions={
        <IconButton
          icon="refresh"
          label="Refresh workout history"
          busy={state.refreshing}
          onPress={state.refresh}
        />
      }
    >
      <Card>
        <MonthCalendar
          status={
            <ResourceStatus
              inline
              label="Calendar records"
              state={state}
              refresh={state.refresh}
            />
          }
          month={month}
          today={today}
          selected={selected ?? undefined}
          onMonthChange={setMonth}
          onSelect={setSelected}
          markers={markers}
        />
      </Card>
      {local.length > 0 && (
        <>
          <AppText variant="eyebrow" tone="muted">
            Saved on this phone
          </AppText>
          {local
            .slice()
            .reverse()
            .map((workout) => (
              <ListRow
                key={workout.id}
                title={workout.sessionName}
                subtitle={`${workout.date} · ${workout.pending.length ? 'Upload pending' : 'Uploaded'}`}
                onPress={() => openWorkout(workout.id)}
              />
            ))}
        </>
      )}
      <Sheet
        visible={selected !== null}
        title={selected ?? 'Workouts'}
        onClose={() => setSelected(null)}
      >
        {selected && <HistoryDay key={selected} date={selected} />}
      </Sheet>
    </WorkoutLayout>
  );
}
