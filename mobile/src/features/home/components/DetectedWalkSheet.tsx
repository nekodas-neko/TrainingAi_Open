import { useState } from 'react';
import { randomUUID } from 'expo-crypto';
import { formatTimeOfDay } from '@trainingai/shared/date-utils';
import {
  AppButton,
  AppText,
  SegmentedControl,
  Stack,
  StatusIndicator,
  TextField,
} from '../../../shared/ui';
import { Sheet } from '../../../shared/ui/Sheet';
import { useActivities } from '../../activities/data/ActivityProvider';
import { useWorkoutAction } from '../../workouts/data/useWorkoutAction';
import {
  choiceSpan,
  confirmDetectedWalk,
  initialChoice,
  type DetectedWalk,
  type WalkChoice,
} from '../data/detected-walks';
import { useHome } from '../data/HomeProvider';

/**
 * Review a detected walk: save it as a walk or a run, change its times first if they are off, or
 * dismiss it. The current app's `ExerciseReviewSheet`, with the times editable (#3625).
 */
export function DetectedWalkSheet({
  walk,
  timezone,
  onClose,
}: {
  walk: DetectedWalk;
  timezone: string;
  onClose: () => void;
}) {
  const activity = useActivities();
  const home = useHome();
  const action = useWorkoutAction();
  const [choice, setChoice] = useState<WalkChoice>(() => initialChoice(walk, timezone));
  const span = choiceSpan(walk, choice, timezone);
  const minutes = span ? Math.round((span.endMs - span.startMs) / 60_000) : null;
  const label = choice.type === 'run' ? 'Run' : 'Walk';
  return (
    <Sheet
      visible
      title="Walk detected"
      onClose={onClose}
      actions={<StatusIndicator label="Detected walk" busy={action.busy} error={action.error} />}
      footer={
        <Stack direction="row">
          <AppButton
            title="Dismiss"
            variant="ghost"
            disabled={action.busy}
            onPress={() =>
              void action.run(async () => {
                await home.store!.answerWalk(walk.startMs);
                onClose();
              })
            }
          />
          <AppButton
            title={`Save as ${label}`}
            busy={action.busy}
            disabled={!span || !activity.ready || !activity.store || !home.store}
            style={{ flex: 1 }}
            onPress={() =>
              void action.run(async () => {
                const saved = await confirmDetectedWalk(
                  {
                    saveRecord: (payload) => activity.store!.saveRecord(payload),
                    answer: (startMs) => home.store!.answerWalk(startMs),
                    uuid: randomUUID,
                    timezone,
                  },
                  walk,
                  choice,
                );
                if (saved) onClose();
              }, 'Activity saved')
            }
          />
        </Stack>
      }
    >
      <AppText variant="caption" tone="muted">
        Looks like you walked {formatTimeOfDay(walk.startMs, timezone)}–
        {formatTimeOfDay(walk.endMs, timezone)}. Check the details, then save it.
      </AppText>
      <SegmentedControl
        label="Activity type"
        options={[
          { label: 'Walk', value: 'walk' },
          { label: 'Run', value: 'run' },
        ]}
        value={choice.type}
        onChange={(type) => setChoice((old) => ({ ...old, type }))}
      />
      <Stack direction="row">
        {(['start', 'end'] as const).map((key) => (
          <TextField
            key={key}
            label={key === 'start' ? 'Start (24 h, HH:MM)' : 'End (24 h, HH:MM)'}
            value={choice[key]}
            keyboardType="numbers-and-punctuation"
            maxLength={5}
            onChangeText={(value) => setChoice((old) => ({ ...old, [key]: value }))}
          />
        ))}
      </Stack>
      <AppText variant="caption" tone="muted">
        {minutes !== null
          ? `${minutes} min`
          : 'Enter a start and an end time, the end after the start.'}
      </AppText>
    </Sheet>
  );
}
