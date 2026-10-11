import { useState } from 'react';
import { toAestDay } from '@trainingai/shared/date-utils';
import {
  AppButton,
  AppText,
  Badge,
  Card,
  ConfirmationCard,
  IconButton,
  ListRow,
  Notice,
  NumericStepper,
  Sheet,
  Stack,
} from '../../../shared/ui';
import { useTheme } from '../../../shared/theme/ThemeProvider';
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

function HistoryDay({ date }: { date: string }) {
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
    return journal.data.workouts.some((workout) => workout.id === id && workout.pending.length > 0);
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
          Workouts
        </AppText>
        <IconButton
          icon="refresh"
          label="Refresh day"
          busy={state.refreshing}
          onPress={state.refresh}
        />
      </Stack>
      <ResourceStatus state={state} refresh={state.refresh} />
      {queue.error && <Notice title="History upload" message={queue.error} />}{' '}
      {queue.operations.length > 0 && (
        <AppButton
          title={queue.syncing ? 'Uploading changes…' : 'Retry history upload'}
          variant="ghost"
          busy={queue.syncing}
          onPress={() => {
            void queue.queue?.sync();
          }}
        />
      )}
      {action.error && <Notice title="History change" message={action.error} />}
      {sessionIds.map((id) => (
        <Card key={id}>
          <Stack direction="row" justify="space-between">
            <AppText variant="heading">
              {entries.find((entry) => entry.workoutSessionId === id)?.sessionName}
            </AppText>
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
          </Stack>
          {state.data?.workoutDurationsById?.[id] && (
            <AppText variant="caption" tone="muted">
              {Math.round(state.data.workoutDurationsById[id]!.minutes)} min
            </AppText>
          )}
          {entries
            .filter((entry) => entry.workoutSessionId === id)
            .map((entry) => (
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
            ))}
        </Card>
      ))}
      {state.data && entries.length === 0 && (
        <AppText tone="muted">No workouts recorded for this day.</AppText>
      )}
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
                onChange={(rep) => setReps(reps.map((value, at) => (at === index ? rep : value)))}
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
  const { theme } = useTheme();
  const journal = useWorkoutJournal();
  const today = toAestDay(new Date(), timezone);
  const [month, setMonth] = useState(today.slice(0, 7));
  const [selected, setSelected] = useState<string | null>(null);
  const [year, number] = month.split('-').map(Number);
  const state = useWorkoutResource(calendarSpec(year, number));
  const first = (new Date(Date.UTC(year, number - 1, 1)).getUTCDay() + 6) % 7;
  const count = new Date(Date.UTC(year, number, 0)).getUTCDate();
  const local = journal.data.workouts.filter(
    (workout) => workout.status === 'completed' && workout.date.startsWith(month),
  );
  function move(direction: number) {
    const next = new Date(Date.UTC(year, number - 1 + direction, 1));
    setMonth(`${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}`);
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
      <ResourceStatus state={state} refresh={state.refresh} />
      <Card>
        <Stack direction="row" justify="space-between" align="center">
          <IconButton
            icon="back"
            label="Previous month"
            onPress={year > 2000 || number > 1 ? () => move(-1) : undefined}
          />
          <AppText variant="heading">
            {new Intl.DateTimeFormat('en-AU', {
              month: 'long',
              year: 'numeric',
              timeZone: 'UTC',
            }).format(new Date(Date.UTC(year, number - 1, 1)))}
          </AppText>
          <IconButton
            icon="forward"
            label="Next month"
            onPress={year < 2100 || number < 12 ? () => move(1) : undefined}
          />
        </Stack>
        <Stack direction="row" style={{ gap: 0 }}>
          {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((day, index) => (
            <AppText
              key={index}
              variant="micro"
              tone="muted"
              style={{ width: '14.2857%', textAlign: 'center' }}
            >
              {day}
            </AppText>
          ))}
        </Stack>
        <Stack direction="row" wrap style={{ gap: 0 }}>
          {Array.from({ length: first + count }, (_, index) => {
            const day = index - first + 1;
            if (day < 1) {
              return (
                <Stack
                  key={index}
                  style={{ width: '14.2857%', minHeight: theme.sizes.touchTarget }}
                />
              );
            }
            const date = `${month}-${String(day).padStart(2, '0')}`;
            const trained =
              (
                state.data?.trainedDays[date] ??
                state.data?.trainedDays[date.replace(/-/g, '/')] ??
                []
              ).length > 0 || local.some((workout) => workout.date === date);
            return (
              <AppButton
                key={index}
                title={`${day}${trained ? ' •' : ''}`}
                accessibilityLabel={`${date}${trained ? ', workout recorded' : ''}`}
                variant={date === today ? 'primary' : trained ? 'secondary' : 'ghost'}
                onPress={() => setSelected(date)}
                style={{ width: '14.2857%', paddingHorizontal: 0 }}
              />
            );
          })}
        </Stack>
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
