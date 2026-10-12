import type { MealLoggingStatus as Status } from '@trainingai/shared/nutrition/meal-logging-status';
import { AppButton, Badge, Stack } from '../../../shared/ui';
import { useTheme } from '../../../shared/theme/ThemeProvider';

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
        label={
          status === 'recorded' ? 'Recorded' : status === 'skipped' ? 'Skipped' : 'Not recorded'
        }
        tone={status === 'recorded' ? 'brand' : 'neutral'}
        style={{ alignSelf: 'center' }}
      />
      {status !== 'recorded' && (
        <AppButton
          title={status === 'skipped' ? 'Undo skip' : 'Skipped'}
          accessibilityLabel={
            status === 'skipped' ? `Undo skipped ${mealName}` : `Mark ${mealName} as skipped`
          }
          icon={status === 'skipped' ? 'refresh' : 'skip'}
          variant="ghost"
          busy={busy}
          onPress={() => onChange(status !== 'skipped')}
        />
      )}
    </Stack>
  );
}
