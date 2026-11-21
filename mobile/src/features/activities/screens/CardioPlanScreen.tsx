import { useState } from 'react';
import { View } from 'react-native';
import { AppButton, AppText, Card, Icon, PageLayout, Stack, TouchSurface } from '../../../shared/ui';
import { useTheme } from '../../../shared/theme/ThemeProvider';
import { useHealthData } from '../../health/data/HealthDataProvider';
import { useWorkoutResource } from '../../workouts/data/WorkoutDataProvider';
import { useWorkoutAction } from '../../workouts/data/useWorkoutAction';
import { cardioWeekSpec, runningPlanSpec } from '../data/models';
import {
  PLAN_CHOICE_EYEBROW,
  PLAN_CHOICE_NOTE,
  PLAN_CHOICE_TILES,
  planChoiceButton,
  type PlanChoice,
} from '../data/cardio-plan-view';

const paths = ['/api/running-plan', '/api/cardio-week'];

/** "Walk or run", asked first (#3779, 1A). Walking starts at once; Running opens the goal picker. */
export function CardioPlanScreen({
  onBack,
  openRunningGoals,
}: {
  onBack: () => void;
  openRunningGoals: () => void;
}) {
  const { today } = useHealthData();
  const { theme } = useTheme();
  const state = useWorkoutResource(runningPlanSpec(today));
  const action = useWorkoutAction();
  const [choice, setChoice] = useState<PlanChoice>('walking');
  const size = theme.sizes.avatar - theme.spacing.sm;
  async function go() {
    if (choice === 'running') {
      openRunningGoals();
      return;
    }
    await action.run(async () => {
      await state.resources!.write('POST', '/api/running-plan', { goalKind: 'walking' }, paths);
      await state.resources!.load(runningPlanSpec(today), true);
      await state.resources!.load(cardioWeekSpec(today), true);
      onBack();
    });
  }
  return (
    <PageLayout title="Cardio plan" scroll onBack={onBack}>
      <AppText variant="eyebrow" tone="muted">
        {PLAN_CHOICE_EYEBROW}
      </AppText>
      {PLAN_CHOICE_TILES.map((tile) => {
        const selected = tile.key === choice;
        return (
          <TouchSurface
            key={tile.key}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            onPress={() => setChoice(tile.key)}
          >
            <Card
              style={{
                borderColor: selected ? theme.colors.brandBorder : theme.colors.border,
                backgroundColor: selected ? theme.colors.brandSurface : theme.colors.surface,
              }}
            >
              <Stack direction="row" align="center" gap="md">
                <View
                  style={{
                    width: size,
                    height: size,
                    borderRadius: theme.radii.control,
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: theme.colors.brandSurface,
                  }}
                >
                  <Icon name={tile.key === 'walking' ? 'steps' : 'cardio'} tone="brand" />
                </View>
                <Stack gap="xs" style={{ flex: 1 }}>
                  <AppText variant="heading">{tile.title}</AppText>
                  <AppText variant="caption" tone="muted">
                    {tile.caption}
                  </AppText>
                </Stack>
                <Icon
                  name={selected ? 'check' : 'forward'}
                  tone={selected ? 'brand' : 'muted'}
                  size={theme.sizes.iconSmall}
                />
              </Stack>
            </Card>
          </TouchSurface>
        );
      })}
      <AppText variant="caption" tone="muted">
        {PLAN_CHOICE_NOTE}
      </AppText>
      {action.error && (
        <AppText variant="caption" tone="danger">
          {action.error}
        </AppText>
      )}
      <AppButton title={planChoiceButton(choice)} busy={action.busy} onPress={() => void go()} />
    </PageLayout>
  );
}
