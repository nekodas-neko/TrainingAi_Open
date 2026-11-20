import {
  EFFORT_VS_PLAN_LABELS,
  EFFORT_VS_PLAN_VALUES,
  type EffortVsPlan,
} from '@trainingai/shared/workout/effort-vs-plan';
import { AppText, ChoiceScale, Stack } from '../../../shared/ui';
import type { WorkoutExercise } from '../logging/workout';

const options = EFFORT_VS_PLAN_VALUES.map((value) => ({
  value,
  label: EFFORT_VS_PLAN_LABELS[value],
  description: EFFORT_VS_PLAN_LABELS[value],
}));

/**
 * #3745: once per exercise, on the rest card after its last set. It starts on As expected; a tap
 * on any answer, the starting one included, records it as the lifter's own.
 */
export function EffortQuestion({
  exercise,
  onAnswer,
  disabled,
}: {
  exercise: WorkoutExercise;
  onAnswer: (value: EffortVsPlan) => void;
  disabled: boolean;
}) {
  return (
    <Stack gap="xs">
      <AppText variant="label">How did {exercise.name} feel?</AppText>
      <ChoiceScale
        label={`How did ${exercise.name} feel`}
        options={options}
        value={exercise.effortVsPlan ?? 0}
        onChange={(value) => onAnswer(value as EffortVsPlan)}
        disabled={disabled}
      />
    </Stack>
  );
}
