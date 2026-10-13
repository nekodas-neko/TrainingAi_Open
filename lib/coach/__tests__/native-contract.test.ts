import { test } from 'vitest';
import assert from 'node:assert/strict';
import { CoachPatchSchema as backendPatch } from '../patch';
import { CoachWidgetSchema as backendWidget } from '../widgets';
import { CoachPatchSchema } from '../../../mobile/src/features/coach/data/patch';
import { CoachWidgetSchema } from '../../../mobile/src/features/coach/data/widgets';
const id = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
test('native patch and widget contracts match backend validation including numeric bounds', () => {
  const proposals = [
    {
      domain: 'user_goals',
      targetId: null,
      changes: [{ id: 'goal', field: 'stepsGoal', from: 8000, to: 12000 }],
    },
    {
      domain: 'nutrition_targets',
      targetId: null,
      changes: [{ id: 'calories', field: 'calories', from: 2000, to: 26000 }],
    },
    {
      domain: 'program_phase',
      targetId: id(9),
      changes: [{ id: 'cycle', field: 'sessionsPerCycle', from: 6, to: 8 }],
    },
  ];
  for (const patch of proposals) {
    assert.equal(
      CoachPatchSchema.safeParse(patch).success,
      backendPatch.safeParse(patch).success,
    );
    const widget = { kind: 'change_preview', title: 'Review', patch };
    assert.equal(
      CoachWidgetSchema.safeParse(widget).success,
      backendWidget.safeParse(widget).success,
    );
  }
  assert.equal(
    CoachWidgetSchema.safeParse({
      kind: 'handoff',
      title: 'Open',
      destination: 'https://evil.example',
    }).success,
    false,
  );
});
