import { z } from 'zod';
import { deriveEndTime } from '@trainingai/shared/validation/activity-log';
import { AppButton, Sheet, StatusIndicator, TextField } from '../../../shared/ui';
import type { HealthActivity } from '../../health/components/ActivityDetails';
import { useWorkoutDraft } from '../../workouts/data/useWorkoutDraft';
import { useWorkoutAction } from '../../workouts/data/useWorkoutAction';
import { profileSpec } from '../../health/data/models';
import { useWorkoutResource } from '../../workouts/data/WorkoutDataProvider';
import { treadmillSteps } from '../data/guidance';
import { useActivities } from '../data/ActivityProvider';
const schema = z.object({
  title: z.string(),
  duration: z.string(),
  distance: z.string(),
  notes: z.string(),
});
export function ActivityEditor({ log, onClose }: { log: HealthActivity; onClose: () => void }) {
  const profile = useWorkoutResource(profileSpec);
  const activity = useActivities(),
    action = useWorkoutAction();
  const draft = useWorkoutDraft(`activity-edit:${log.id}`, schema, {
    title: log.title ?? log.activityType,
    duration: log.durationMin?.toString() ?? '',
    distance: log.distanceKm?.toString() ?? '',
    notes: log.notes ?? '',
  });
  return (
    <Sheet visible title="Edit activity" onClose={onClose}>
      <StatusIndicator
        label="Activity editor"
        busy={action.busy}
        error={action.error ?? draft.error}
      />
      {(['title', 'duration', 'distance', 'notes'] as const).map((key) => (
        <TextField
          key={key}
          label={
            {
              title: 'Title',
              duration: 'Duration (min)',
              distance: 'Distance (km)',
              notes: 'Notes (optional)',
            }[key]
          }
          value={draft.value[key]}
          keyboardType={key === 'duration' || key === 'distance' ? 'decimal-pad' : 'default'}
          maxLength={key === 'notes' ? 1000 : key === 'title' ? 120 : 20}
          onChangeText={(value) => draft.setValue((old) => ({ ...old, [key]: value }))}
        />
      ))}
      <AppButton
        title="Save changes"
        busy={action.busy}
        disabled={!activity.ready || !draft.ready}
        onPress={() =>
          void action.run(async () => {
            const value = draft.value;
            const payload: Record<string, unknown> = {
              ...Object.fromEntries(Object.entries(log).filter(([, value]) => value != null)),
              title: value.title.trim(),
              notes: value.notes.trim() || undefined,
              durationMin: value.duration.trim()
                ? Number(value.duration.replace(',', '.'))
                : undefined,
              distanceKm: value.distance.trim()
                ? Number(value.distance.replace(',', '.'))
                : undefined,
            };
            if (
              payload.durationMin !== log.durationMin ||
              payload.distanceKm !== log.distanceKm
            ) {
              delete payload.avgPaceSecPerKm;
              delete payload.caloriesBurned;
              if (log.activityType === 'treadmill' && !log.cadenceSource) {
                payload.steps =
                  treadmillSteps(
                    payload.distanceKm as number | undefined,
                    profile.data?.user.heightCm,
                  ) ?? undefined;
              }
            }
            if (!(Number(payload.caloriesBurned) > 0)) {
              delete payload.caloriesBurned;
            }
            await activity.store!.saveRecord({
              ...payload,
              endTime: deriveEndTime(
                log.startTime ?? undefined,
                payload.durationMin as number | undefined,
                undefined,
              ),
            });
            onClose();
          })
        }
      />
    </Sheet>
  );
}
