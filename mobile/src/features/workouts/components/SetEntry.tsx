import { feedback } from '../../../integrations/feedback/haptics';
import { useCallback, useState } from 'react';
import { View } from 'react-native';
import {
  AppButton,
  Disclosure,
  NumberWheel,
  SegmentedControl,
  RepCounter,
  Stack,
} from '../../../shared/ui';
import { useTheme } from '../../../shared/theme/ThemeProvider';
import type { WorkoutExercise, WorkoutRecord, WorkoutSet } from '../logging/workout';
import { useWorkoutJournal } from '../logging/WorkoutJournalProvider';
import { isAmrap, weightStep } from '../logging/targets';
import { displayLoad, storedLoad } from '../logging/preferences';
import { EffortPicker } from './EffortPicker';
import { VoiceLogButton } from './VoiceLogButton';
import { voiceSetValues } from '../voice/voice';

export function SetEntry({
  workout,
  exercise,
  set,
  index,
  fill = false,
}: {
  workout: WorkoutRecord;
  exercise: WorkoutExercise;
  set: WorkoutSet;
  index: number;
  fill?: boolean;
}) {
  const journal = useWorkoutJournal();
  const { theme, textScale } = useTheme();
  const [controlsLayout, setControlsLayout] = useState({ width: 0, height: 0 });
  const [assistanceHeight, setAssistanceHeight] = useState(0);
  const minimumRow = Math.max(
    theme.sizes.wheelRow,
    theme.typography.display.lineHeight! * textScale + theme.spacing.sm,
  );
  const bodyweight = exercise.exerciseType === 'bodyweight';
  const expanded = fill;
  const rowHeight = expanded
    ? Math.max(minimumRow, Math.floor((controlsLayout.height - theme.spacing.sm) / 3))
    : minimumRow;
  const columnWidth =
    controlsLayout.width > 0
      ? (controlsLayout.width - (bodyweight ? 0 : theme.spacing.md)) /
        (bodyweight ? 1 : 2)
      : undefined;
  const minimumHeight =
    minimumRow * 3 +
    theme.spacing.sm +
    (bodyweight ? assistanceHeight : theme.sizes.touchTarget + theme.spacing.xs * 2) +
    theme.sizes.loggingControl +
    theme.typography.caption.lineHeight! * textScale +
    theme.spacing.sm +
    theme.sizes.touchTarget +
    theme.typography.caption.lineHeight! * textScale +
    theme.spacing.xs +
    theme.spacing.md * 3;
  const columnStyle =
    columnWidth === undefined
      ? { flex: 1, flexBasis: 0, minWidth: 0 }
      : { width: columnWidth, flexShrink: 0, minWidth: 0 };

  const unit = exercise.weightUnit;
  const amrap = isAmrap(workout, exercise, index);
  const controller = journal.controller;
  const updateWeight = useCallback(
    (value: string) =>
      controller?.updateSet(
        workout.id,
        exercise.id,
        set.id,
        'weight',
        storedLoad(value, unit),
      ),
    [controller, workout.id, exercise.id, set.id, unit],
  );
  const step = unit === 'lb' ? 2.5 : weightStep(exercise.equipment);
  const applyVoice = useCallback(
    (heard: { weight?: number; reps?: number }) => {
      const { weight, reps } = voiceSetValues(heard, step, unit);
      if (weight !== undefined) {
        controller?.updateSet(workout.id, exercise.id, set.id, 'weight', weight);
      }
      if (reps !== undefined) {
        controller?.updateSet(workout.id, exercise.id, set.id, 'reps', reps);
      }
    },
    [controller, step, unit, workout.id, exercise.id, set.id],
  );
  const units = (
    <SegmentedControl
      label="Weight display unit"
      options={[
        { label: 'kg', value: 'kg' },
        { label: 'lb', value: 'lb' },
      ]}
      value={unit}
      onChange={(value) => {
        if (!journal.busy) {
          void journal.controller?.setWeightUnit(workout.id, exercise.id, value);
        }
      }}
    />
  );
  const loadWheel = (label: string, min = 0) => (
    <NumberWheel
      key={unit}
      label={label}
      value={displayLoad(set.weight, unit)}
      onChange={updateWeight}
      step={step}
      min={unit === 'lb' ? (min < 0 ? -220 : 0) : min}
      max={unit === 'lb' ? 1102 : 500}
      disabled={journal.busy}
      rowHeight={rowHeight}
      gesturePaddingStart={bodyweight ? 0 : theme.spacing.md}
      gesturePaddingEnd={bodyweight ? 0 : theme.spacing.xs}
    />
  );
  return (
    <Stack gap="md" style={expanded ? { flex: 1, minHeight: minimumHeight } : undefined}>
      {!bodyweight && units}
      <View
        style={
          expanded ? { flex: 1, minHeight: minimumRow * 3 + theme.spacing.sm } : undefined
        }
        onLayout={(event) => {
          const { width, height } = event.nativeEvent.layout;
          setControlsLayout((current) =>
            current.width === width && current.height === height
              ? current
              : { width, height },
          );
        }}
      >
        <Stack direction="row" align="flex-start" gap="md">
          {!bodyweight && (
            <View style={[columnStyle, { height: rowHeight * 3 }]}>
              {loadWheel(`Weight (${unit})`)}
            </View>
          )}
          <View style={columnStyle}>
            <RepCounter
              value={set.reps}
              onChange={(value) =>
                controller?.updateSet(workout.id, exercise.id, set.id, 'reps', value)
              }
              label={`Reps for ${exercise.name}, set ${index + 1}${amrap ? ', AMRAP' : ''}`}
              caption={amrap ? 'Reps (AMRAP)' : 'Reps'}
              disabled={journal.busy}
              rowHeight={rowHeight}
            />
          </View>
        </Stack>
      </View>
      {bodyweight && (
        <View onLayout={(event) => setAssistanceHeight(event.nativeEvent.layout.height)}>
          <Disclosure
            title={
              Number(set.weight) === 0
                ? 'Add load / assistance'
                : `${Number(set.weight) > 0 ? '+' : ''}${displayLoad(set.weight, unit)} ${unit} load / assistance`
            }
          >
            {units}
            {loadWheel(`Added / assisted load (${unit})`, -100)}
          </Disclosure>
        </View>
      )}
      <VoiceLogButton onResult={applyVoice} disabled={journal.busy} />
      <EffortPicker
        set={set}
        disabled={journal.busy}
        onChange={(rpe) => {
          void journal.controller?.rateSet(workout.id, exercise.id, set.id, rpe);
        }}
      />
    </Stack>
  );
}
export function SetActions({
  workout,
  exercise,
  set,
  index,
}: {
  workout: WorkoutRecord;
  exercise: WorkoutExercise;
  set: WorkoutSet;
  index: number;
}) {
  const journal = useWorkoutJournal();
  const running = workout.runningSet?.setId === set.id;
  return (
    <AppButton
      title={running ? `Log Set ${index + 1}` : `Start Set ${index + 1}`}
      disabled={journal.busy || (!!workout.runningSet && !running)}
      onPress={() => {
        void (
          running
            ? journal.controller?.recordSet(workout.id, exercise.id, set.id)
            : journal.controller?.startSet(workout.id, exercise.id, set.id)
        )?.then((saved) => {
          if (saved && running) feedback('success');
        });
      }}
    />
  );
}
