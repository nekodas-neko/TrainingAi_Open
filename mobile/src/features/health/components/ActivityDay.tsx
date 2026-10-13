import { useState } from 'react';
import { Pressable } from 'react-native';
import {
  activityFacts as facts,
  ActivityDetails,
  type HealthActivity as Activity,
} from './ActivityDetails';
import { formatHoursMinutes } from '@trainingai/shared/format/units';
import {
  AppText,
  Card,
  ConfirmationCard,
  IconButton,
  KeyValueGrid,
  Sheet,
  Stack,
  StatusIndicator,
} from '../../../shared/ui';
import { activityHistorySpec, metricValue } from '../data/models';
import { useHistoryQueue } from '../../workouts/data/HistoryQueueProvider';
import { useWorkoutAction } from '../../workouts/data/useWorkoutAction';
import { useActivities, useActivityLogs } from '../../activities/data/ActivityProvider';
export function ActivityDay({ logs, date }: { logs: Activity[]; date: string }) {
  const queue = useHistoryQueue();
  const action = useWorkoutAction();
  const [selected, setSelected] = useState<Activity | null>(null);
  const [remove, setRemove] = useState<Activity | null>(null);
  const visible = useActivityLogs(logs, date, date);
  const activity = useActivities();
  if (!visible.length && !remove && !selected) {
    return null;
  }
  return (
    <>
      <Stack direction="row" justify="space-between">
        <AppText variant="eyebrow" tone="muted">
          Activity
        </AppText>
        <StatusIndicator
          label="Activity changes"
          busy={queue.syncing || activity.syncing}
          error={action.error ?? queue.error ?? activity.error}
          message={
            queue.operations.length || activity.pending ? 'Changes saved on phone.' : null
          }
          onRetry={() => {
            void queue.queue?.sync();
            void activity.store?.sync();
          }}
        />
      </Stack>
      {visible.map((log) => (
        <Card key={log.id}>
          <Stack direction="row" align="center">
            <Pressable
              style={{ flex: 1 }}
              accessibilityRole="button"
              accessibilityLabel={`${log.title ?? log.activityType} detail`}
              onPress={() => setSelected(log)}
            >
              <AppText variant="label">{log.title ?? log.activityType}</AppText>
              <AppText variant="micro" tone="muted">
                {log.startTime ?? ''}
              </AppText>
            </Pressable>
            <AppText variant="caption">
              {log.durationMin == null ? '—' : formatHoursMinutes(log.durationMin)}
            </AppText>
            <IconButton
              icon="delete"
              label={`Delete ${log.title ?? log.activityType}`}
              disabled={
                !queue.ready ||
                activity.rows.some((row) => row.pending && row.payload.id === log.id)
              }
              onPress={() => setRemove(log)}
            />
          </Stack>
          <KeyValueGrid rows={facts(log)} />
          {log.notes && (
            <AppText variant="caption" tone="muted">
              {log.notes}
            </AppText>
          )}
        </Card>
      ))}
      <Sheet
        fullHeight
        visible={selected !== null}
        title={selected?.title ?? selected?.activityType ?? 'Activity'}
        onClose={() => setSelected(null)}
      >
        {selected && <ActivityDetails log={selected} />}
      </Sheet>
      <Sheet visible={remove !== null} title="Delete activity" onClose={() => setRemove(null)}>
        {remove && (
          <ConfirmationCard
            title={`Delete ${remove.title ?? remove.activityType}?`}
            message="This removes the activity from your history."
            danger
            confirmLabel="Delete"
            cancelLabel="Cancel"
            busy={action.busy}
            onCancel={() => setRemove(null)}
            onConfirm={() =>
              void action.run(async () => {
                if (!queue.queue) {
                  throw new Error('Connect your account first.');
                }
                await queue.queue.enqueue('activity_logs', remove.date, {
                  id: remove.id,
                  deleted: true,
                });
                setRemove(null);
              })
            }
          />
        )}
      </Sheet>
    </>
  );
}
