import { ACTIVITY_LEVELS } from '@trainingai/shared/types/user';
import { useState } from 'react';
import { z } from 'zod';
import {
  AppButton,
  AppText,
  Card,
  MarkdownText,
  MultiChoice,
  Sheet,
  Stack,
  StatusIndicator,
} from '../../../shared/ui';
import { useWorkoutResources } from '../../workouts/data/WorkoutDataProvider';
import { useWorkoutDraft } from '../../workouts/data/useWorkoutDraft';
import { useNutrition } from '../data/NutritionProvider';
const recSchema = z.object({
  id: z.string(),
  current: z
    .object({
      stepsGoal: z.number().nullable(),
      stepsGoalType: z.string().nullable(),
      waterGoalMl: z.number().nullable(),
      waterGoalType: z.string().nullable(),
      proteinG: z.number().nullable(),
      carbsG: z.number().nullable(),
      fatG: z.number().nullable(),
      activityLevel: z.string().nullable(),
    })
    .passthrough(),
  recommended: z.object({
    stepsGoal: z.number(),
    calories: z.number(),
    proteinG: z.number(),
    carbsG: z.number(),
    fatG: z.number(),
    waterMl: z.number(),
    activityLevel: z.enum(ACTIVITY_LEVELS).nullable(),
  }),
  reasoning: z.string(),
  insights: z.string(),
  dataQualityNote: z.string(),
});
export function GoalRecommendation({
  onClose,
  onApplied,
}: {
  onClose: () => void;
  onApplied: (changes?: { goals: Record<string, number>; activityLevel?: string }) => void;
}) {
  const resources = useWorkoutResources();
  const n = useNutrition();
  const draft = useWorkoutDraft(
    'nutrition-goal-recommendation',
    z.object({ rec: recSchema.nullable(), selected: z.array(z.string()) }),
    { rec: null, selected: ['steps', 'protein', 'carbs', 'fat', 'water', 'activity'] },
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rec = draft.value.rec;
  async function generate() {
    if (!resources) {
      return;
    }
    setBusy(true);
    try {
      const rec = recSchema.parse(
        await resources.connection.post('/api/nutrition-goals/recommend', {}),
      );
      draft.setValue({
        rec,
        selected: ['steps', 'protein', 'carbs', 'fat', 'water', 'activity'],
      });
      setError(null);
    } catch {
      setError(
        'Could not review goals. Check your height, weight, sex, date of birth and fitness goal in Profile.',
      );
    } finally {
      setBusy(false);
    }
  }
  async function apply() {
    if (!rec || !resources) {
      return;
    }
    setBusy(true);
    const selected = new Set(draft.value.selected);
    const goals: Record<string, number> = {};
    const targets: Record<string, number> = {};
    if (selected.has('steps')) {
      goals.stepsGoal =
        rec.recommended.stepsGoal * (rec.current.stepsGoalType === 'weekly' ? 7 : 1);
    }
    if (selected.has('water')) {
      goals.waterGoalMl =
        rec.recommended.waterMl * (rec.current.waterGoalType === 'weekly' ? 7 : 1);
    }
    for (const [choice, key] of [
      ['protein', 'proteinG'],
      ['carbs', 'carbsG'],
      ['fat', 'fatG'],
    ] as const) {
      if (selected.has(choice)) {
        targets[key] = rec.recommended[key];
      }
    }
    try {
      const requests: Promise<unknown>[] = [];
      if (Object.keys(goals).length) {
        requests.push(
          resources.write('PATCH', '/api/user/goals', goals, [
            '/api/user/goals',
            '/api/nutrition',
            '/api/body-metadata',
          ]),
        );
      }
      if (Object.keys(targets).length) {
        requests.push(
          resources.write('PUT', '/api/nutrition/targets', targets, ['/api/nutrition']),
        );
      }
      if (selected.has('activity') && rec.recommended.activityLevel) {
        requests.push(
          resources.write(
            'PATCH',
            '/api/user/profile',
            { activityLevel: rec.recommended.activityLevel },
            ['/api/user/profile', '/api/nutrition'],
          ),
        );
      }
      const results = await Promise.allSettled(requests);
      if (results.some((r) => r.status === 'rejected')) {
        throw new Error(
          'Some selected goals could not be saved. Nothing was marked applied; retry to finish.',
        );
      }
      await resources.write('PATCH', `/api/nutrition-goals/${rec.id}`, { status: 'applied' }, [
        '/api/user/goals',
        '/api/nutrition',
        '/api/body-metadata',
      ]);
      await n.store?.refresh('targets', n.today, true);
      await resources.clearDraft('nutrition-goal-recommendation');
      onApplied({
        goals,
        ...(selected.has('activity') && rec.recommended.activityLevel
          ? { activityLevel: rec.recommended.activityLevel }
          : {}),
      });
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not apply the selected goals.');
    } finally {
      setBusy(false);
    }
  }
  const options = rec
    ? [
        {
          value: 'steps',
          label: `Steps: ${rec.current.stepsGoal ?? '—'} → ${rec.recommended.stepsGoal * (rec.current.stepsGoalType === 'weekly' ? 7 : 1)} (${rec.current.stepsGoalType ?? 'daily'})`,
        },
        {
          value: 'protein',
          label: `Protein: ${rec.current.proteinG ?? '—'} → ${rec.recommended.proteinG} g`,
        },
        {
          value: 'carbs',
          label: `Carbs: ${rec.current.carbsG ?? '—'} → ${rec.recommended.carbsG} g`,
        },
        { value: 'fat', label: `Fat: ${rec.current.fatG ?? '—'} → ${rec.recommended.fatG} g` },
        {
          value: 'water',
          label: `Water: ${rec.current.waterGoalMl ?? '—'} → ${rec.recommended.waterMl * (rec.current.waterGoalType === 'weekly' ? 7 : 1)} ml (${rec.current.waterGoalType ?? 'daily'})`,
        },
        ...(rec.recommended.activityLevel &&
        rec.recommended.activityLevel !== rec.current.activityLevel
          ? [
              {
                value: 'activity',
                label: `Activity: ${rec.current.activityLevel ?? '—'} → ${rec.recommended.activityLevel}`,
              },
            ]
          : []),
      ]
    : [];
  return (
    <Sheet
      visible
      fullHeight
      title="Review your goals"
      onClose={onClose}
      actions={
        <StatusIndicator
          label="Goal review"
          busy={busy || !draft.ready}
          error={error ?? draft.error}
        />
      }
      footer={
        rec ? (
          <Stack direction="row">
            <AppButton
              title="Dismiss"
              variant="secondary"
              busy={busy}
              onPress={async () => {
                try {
                  await resources!.write(
                    'PATCH',
                    `/api/nutrition-goals/${rec.id}`,
                    { status: 'dismissed' },
                    ['/api/user/goals'],
                  );
                  await resources!.clearDraft('nutrition-goal-recommendation');
                  onClose();
                } catch {
                  setError('Could not dismiss this review.');
                }
              }}
            />
            <AppButton
              title="Apply selected"
              busy={busy}
              disabled={
                !draft.ready ||
                !draft.value.selected.some((s) => options.some((o) => o.value === s))
              }
              onPress={() => void apply()}
            />
          </Stack>
        ) : undefined
      }
    >
      {rec ? (
        <>
          <Card>
            <AppText variant="heading">Why these targets?</AppText>
            <MarkdownText>{rec.reasoning}</MarkdownText>
          </Card>
          <MultiChoice
            label="Changes to apply"
            value={draft.value.selected}
            options={options}
            onChange={(selected) => draft.setValue({ ...draft.value, selected })}
          />
          {rec.insights && (
            <Card>
              <AppText variant="heading">What your data shows</AppText>
              <MarkdownText>{rec.insights}</MarkdownText>
            </Card>
          )}
          {rec.dataQualityNote && (
            <AppText variant="caption" tone="muted">
              {rec.dataQualityNote}
            </AppText>
          )}
          <AppText variant="caption" tone="muted">
            The daily calorie budget still comes from your resting rate, goal and movement.
            Applying this review changes only the selected fields.
          </AppText>
        </>
      ) : (
        <>
          <AppText>
            Your measurements and recent records inform the review. You choose which changes to
            apply.
          </AppText>
          <AppButton
            title="Review goals"
            disabled={!draft.ready}
            busy={busy}
            onPress={() => void generate()}
          />
        </>
      )}
    </Sheet>
  );
}
