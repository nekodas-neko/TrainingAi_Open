import { test } from 'vitest';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { resolve } from 'node:path';
import { CoachPatchSchema as backendPatch } from '../patch';
import { CoachWidgetSchema as backendWidget } from '../widgets';
const id = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

async function nativeContract(name: 'patch' | 'widgets') {
  const result = await build({
    entryPoints: [resolve(`mobile/src/features/coach/data/${name}.ts`)],
    bundle: true,
    format: 'esm',
    platform: 'node',
    tsconfigRaw: {},
    write: false,
  });
  const url = `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].contents).toString('base64')}`;
  return import(/* @vite-ignore */ url);
}

test('native patch and widget contracts match backend validation including numeric bounds', async () => {
  const { CoachPatchSchema } = await nativeContract('patch');
  const { CoachWidgetSchema } = await nativeContract('widgets');
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
    // #3896 step 5: valid, a model-added weight, and a range the schema cannot even read.
    {
      domain: 'lift_preference',
      targetId: id(3),
      changes: [{ id: 'r', field: 'repRange', from: null, to: 'more_reps' }, { id: 's', field: 'setsDelta', from: null, to: -1 }],
    },
    {
      domain: 'lift_preference',
      targetId: id(3),
      changes: [{ id: 'l', field: 'nextLoadStep', from: null, to: 'lighter', weightKg: 40 }],
    },
    {
      domain: 'lift_preference',
      targetId: id(3),
      changes: [{ id: 'r', field: 'repRange', from: null, to: 'twelve' }],
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
