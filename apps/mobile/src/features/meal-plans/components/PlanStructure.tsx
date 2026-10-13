import { useState } from 'react';
import { z } from 'zod';
import {
  AppButton,
  AppText,
  Card,
  NumericStepper,
  Sheet,
  Stack,
  StatusIndicator,
  SwitchRow,
  TextField,
} from '../../../shared/ui';
import type { MealPlan } from '../../nutrition/data/models';
import { useWorkoutDraft } from '../../workouts/data/useWorkoutDraft';
import { useWorkoutResources } from '../../workouts/data/WorkoutDataProvider';
const schema = z.object({
  mealCount: z.string(),
  trainingTime: z.string(),
  retarget: z.boolean(),
  order: z.array(z.number()),
});
export function PlanStructure({
  plan,
  onClose,
  onSaved,
}: {
  plan: MealPlan;
  onClose: () => void;
  onSaved: () => void;
}) {
  const resources = useWorkoutResources();
  const draft = useWorkoutDraft('plan-structure:' + plan.id, schema, {
    mealCount: String(plan.mealsPerDay),
    trainingTime: plan.trainingTime ?? '',
    retarget: false,
    order: plan.variants[0].meals.map((m) => m.position),
  });
  const f = draft.value;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  function move(index: number, offset: number) {
    const order = f.order.slice();
    const to = index + offset;
    if (to < 0 || to >= order.length) {
      return;
    }
    [order[index], order[to]] = [order[to], order[index]];
    draft.setValue({ ...f, order });
  }
  return (
    <Sheet
      visible
      fullHeight
      title="Plan structure"
      onClose={onClose}
      actions={
        <StatusIndicator
          label="Plan structure"
          busy={busy || !draft.ready}
          error={error ?? draft.error}
        />
      }
      footer={
        <AppButton
          title="Save structure"
          busy={busy}
          disabled={!draft.ready}
          onPress={async () => {
            setBusy(true);
            try {
              await resources!.write(
                'PATCH',
                `/api/nutrition/meal-plans/${plan.id}/structure`,
                {
                  mealsPerDay: Number(f.mealCount),
                  trainingTime: f.trainingTime || null,
                  retarget: f.retarget,
                  ...(Number(f.mealCount) === plan.mealsPerDay ? { order: f.order } : {}),
                },
                ['/api/nutrition/meal-plans'],
              );
              await resources!.clearDraft('plan-structure:' + plan.id);
              onSaved();
            } catch {
              setError('Could not save the structure. Your edits are preserved.');
            } finally {
              setBusy(false);
            }
          }}
        />
      }
    >
      <NumericStepper
        label="Meals per day"
        value={f.mealCount}
        min={1}
        max={6}
        onChange={(mealCount) => draft.setValue({ ...f, mealCount })}
      />
      <TextField
        label="Training time (HH:MM, optional)"
        value={f.trainingTime}
        onChangeText={(trainingTime) => draft.setValue({ ...f, trainingTime })}
      />
      <SwitchRow
        label="Update to current targets"
        value={f.retarget}
        onValueChange={(retarget) => draft.setValue({ ...f, retarget })}
      />
      <AppText variant="caption" tone="muted">
        Changing the structure redistributes the day’s targets. New slots need a meal chosen
        afterwards.
      </AppText>
      {f.order.map((position, index) => (
        <Card key={position}>
          <AppText variant="label">
            {plan.variants[0].meals.find((m) => m.position === position)?.name ?? 'Meal'}
          </AppText>
          <Stack direction="row">
            <AppButton
              title="Move up"
              variant="ghost"
              disabled={index === 0}
              onPress={() => move(index, -1)}
            />
            <AppButton
              title="Move down"
              variant="ghost"
              disabled={index === f.order.length - 1}
              onPress={() => move(index, 1)}
            />
          </Stack>
        </Card>
      ))}
    </Sheet>
  );
}
