import { View } from 'react-native';
import { AppButton, AppText, Card, IconButton, Stack } from '../../../shared/ui';
import { useTheme } from '../../../shared/theme/ThemeProvider';
import { useWorkoutJournal } from '../logging/WorkoutJournalProvider';
import { loadSuggestion } from '../logging/targets';
import type { WorkoutExercise, WorkoutRecord, WorkoutSet } from '../logging/workout';

export function LoadSuggestion({
  workout,
  exercise,
  set,
}: {
  workout: WorkoutRecord;
  exercise: WorkoutExercise;
  set: WorkoutSet;
}) {
  const journal = useWorkoutJournal();
  const { theme } = useTheme();
  const suggestion = loadSuggestion(workout, exercise, set);
  if (!suggestion) {
    return null;
  }
  return (
    <Card
      style={{
        padding: theme.spacing.sm,
        backgroundColor: `${theme.anatomy.secondary}1a`,
        borderColor: `${theme.anatomy.secondary}4d`,
      }}
    >
      <Stack direction="row" align="center" gap="sm">
        <View style={{ flex: 1, minWidth: 0 }}>
          <AppText variant="caption" style={{ color: theme.anatomy.secondary }}>
            Drop to {suggestion.weightKg} kg?
          </AppText>
          <AppText variant="micro" tone="muted" numberOfLines={1}>
            {suggestion.note}
          </AppText>
        </View>
        <AppButton
          title="Use it"
          accessibilityLabel="Use suggested load"
          busy={journal.busy}
          onPress={() => {
            void journal.controller?.resolveSuggestion(workout.id, exercise.id, set.id, true);
          }}
          style={{ paddingHorizontal: theme.spacing.md }}
        />
        <IconButton
          icon="close"
          label="Dismiss load suggestion"
          onPress={
            journal.busy
              ? undefined
              : () => {
                  void journal.controller?.resolveSuggestion(
                    workout.id,
                    exercise.id,
                    set.id,
                    false,
                  );
                }
          }
        />
      </Stack>
    </Card>
  );
}
