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
  return (
    <Stack gap="sm">
      <ChoiceScale
        label="RPE"
        options={options}
        value={set.rpeSource === 'rated' ? set.rpe : null}
        onChange={onChange}
        disabled={disabled}
        colorForValue={(value) => theme.effort[value]}
        large
      />
      <AppText variant="caption" tone="muted" style={{ textAlign: 'center' }}>
        RPE rating (difficulty)
      </AppText>
    </Stack>
  );
}
