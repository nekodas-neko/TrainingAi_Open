import { AppText, ChoiceScale, Stack } from '../../../shared/ui';
import type { WorkoutSet } from '../logging/workout';
import { useTheme } from '../../../shared/theme/ThemeProvider';

const options = [
  { value: 6, label: '6', description: 'Light' },
  { value: 7, label: '7', description: 'Moderate' },
  { value: 8, label: '8', description: 'Hard' },
  { value: 9, label: '9', description: 'Very hard' },
  { value: 10, label: '10', description: 'Maximum' },
];

export function EffortPicker({
  set,
  onChange,
  disabled,
}: {
  set: WorkoutSet;
  onChange: (value: number) => void;
  disabled: boolean;
}) {
  const { theme } = useTheme();
  const description =
    options.find((option) => option.value === set.rpe)?.description ?? 'Very light';
  return (
    <Stack gap="sm">
      <ChoiceScale
        label="RPE"
        options={options}
        value={set.rpe}
        onChange={onChange}
        disabled={disabled}
        colorForValue={(value) => theme.effort[value]}
      />
      <AppText variant="caption" tone="muted" style={{ textAlign: 'center' }}>
        {set.rpe === null
          ? 'Rate your effort'
          : `RPE ${set.rpe} · ${description}${set.rpeSource === 'expected' ? ' · expected' : ''}`}
      </AppText>
    </Stack>
  );
}
