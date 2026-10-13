import { formatDayShort } from '@trainingai/shared/date-utils';
import { AppText, Stack, StatusIndicator } from '../../../shared/ui';
import { useWorkoutResource } from '../../workouts/data/WorkoutDataProvider';
import { trainingStressSpec } from '../../workouts/data/models';
import { useHealthData } from '../data/HealthDataProvider';
import { View, useWindowDimensions } from 'react-native';
import { useTheme } from '../../../shared/theme/ThemeProvider';

export function TrainingStressLine() {
  const { today } = useHealthData();
  const { theme } = useTheme();
  const { fontScale } = useWindowDimensions();
  const state = useWorkoutResource({
    ...trainingStressSpec(today),
    query: undefined,
    partition: today,
  });
  const { data } = state;
  const message =
    data?.status === 'ok'
      ? `Training stress today · ${data.ots.toFixed(1)}${data.high ? ' · high load' : ''}` +
        (data.residualShare != null && data.residualShare >= 0.01
          ? ` · ${Math.round(data.residualShare * 100)}% of the last 12 h had no reading`
          : '') +
        (data.rhrFromDay ? ` · resting HR from ${formatDayShort(data.rhrFromDay)}` : '')
      : 'Training stress · no score available yet';
  return (
    <View style={{ height: theme.sizes.touchTarget * fontScale, justifyContent: 'center' }}>
      <Stack direction="row" align="center">
        <AppText
          variant="caption"
          tone="muted"
          style={{ flex: 1 }}
          numberOfLines={2}
          accessibilityLabel={message}
        >
          {message}
        </AppText>
        <StatusIndicator
          label="Training stress"
          busy={state.loading || state.refreshing}
          error={state.error}
          onRetry={state.refresh}
        />
      </Stack>
    </View>
  );
}
