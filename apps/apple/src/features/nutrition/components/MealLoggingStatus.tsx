import type { MealLoggingStatus as Status } from '@trainingai/shared/nutrition/meal-logging-status';
import { AppButton, Badge, Stack } from '../../../shared/ui';
import { useTheme } from '../../../shared/theme/ThemeProvider';

export const mealStatusLabels: Record<Status, string> = {
  recorded: 'Recorded',
  skipped: 'Skipped',
  not_recorded: 'Not recorded',
};

export function MealLoggingStatus({
  status,
  mealName,
  onChange,
  busy = false,
}: {
  status: Status;
  mealName: string;
  onChange: (skipped: boolean) => void;
  busy?: boolean;
}) {
  const { theme } = useTheme();
  return (
    <Stack
      direction="row"
      align="center"
      justify="space-between"
      style={{ paddingHorizontal: theme.spacing.md, minHeight: theme.sizes.button }}
    >
      <Badge
        label={mealStatusLabels[status]}
        tone={status === 'recorded' ? 'brand' : 'neutral'}
        style={{ alignSelf: 'center' }}
      />
      {status !== 'recorded' && (
        <AppButton
          title={status === 'skipped' ? 'Undo skip' : 'Skip meal'}
          accessibilityLabel={
            status === 'skipped' ? `Undo skipped ${mealName}` : `Mark ${mealName} as skipped`
          }
          icon={status === 'skipped' ? 'undo' : 'skip'}
          variant="ghost"
          busy={busy}
          onPress={() => onChange(status !== 'skipped')}
        />
      )}
    </Stack>
  );
}
