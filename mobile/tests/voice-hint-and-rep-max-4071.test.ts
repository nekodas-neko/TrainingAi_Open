import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { registerHooks } from 'node:module';
import { test } from 'node:test';
import { createElement, type ReactElement } from 'react';
import { oneRmText } from '@trainingai/shared/1rm';
import { parseVoice } from '@trainingai/shared/workout/voice-log';
import { isUnloadedSet, formatSetLoad } from '../src/features/workouts/logging/targets.ts';
import { captureSet, voiceExample } from '../src/features/workouts/voice/voice.ts';

// #4071: the voice hint on the set card, rendered. The shared UI is the weekly check-in's plain-HTML
// stand-in; VoiceLogButton and the voice module are the real ones.
const button = new URL('../src/features/workouts/components/VoiceLogButton.tsx', import.meta.url).href;
const stubs = new URL('./fixtures/weekly-checkin-stubs.ts', import.meta.url).href;
registerHooks({
  resolve(specifier, context, next) {
    if (context.parentURL === button && specifier === '../../../shared/ui')
      return { url: stubs, shortCircuit: true };
    return next(specifier, context);
  },
});
const server = 'react-dom/server';
const { renderToStaticMarkup } = (await import(server)) as {
  renderToStaticMarkup: (element: ReactElement) => string;
};
const { VoiceLogButton } = await import(button);

const engine = {
  available: () => true,
  requestPermission: async () => true,
  listen: async () => null,
  stop: () => {},
};
const hint = (props: Record<string, unknown> = {}) =>
  renderToStaticMarkup(
    createElement(VoiceLogButton, { engine, onResult: async () => true, ...props }),
  )
    .replace(/<[^>]+>/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ');

test('#4071: a loaded lift keeps the weight in the voice hint', () => {
  assert.match(hint(), /Say "60 kg 6 reps"/);
  assert.match(hint({ unloaded: false }), /Say "60 kg 6 reps"/);
});

test('#4071: an unloaded lift\'s voice hint has no weight', () => {
  const shown = hint({ unloaded: true });
  assert.match(shown, /Say "6 reps"/);
  assert.doesNotMatch(shown, /kg/);
});

test('#4071: the unloaded test is the set card\'s own: a bodyweight set with no load added', () => {
  const bodyweight = { exerciseType: 'bodyweight' as const };
  assert.equal(isUnloadedSet(bodyweight, { weight: '0' }), true);
  assert.equal(isUnloadedSet(bodyweight, { weight: '' }), true);
  assert.equal(isUnloadedSet(bodyweight, { weight: '10' }), false, 'added load');
  assert.equal(isUnloadedSet(bodyweight, { weight: '-20' }), false, 'assistance');
  assert.equal(isUnloadedSet({ exerciseType: 'weighted' }, { weight: '0' }), false);
  // The card's reps-only line and the hint agree on every case above.
  for (const weight of ['0', '10', '-20']) {
    assert.equal(
      isUnloadedSet(bodyweight, { weight }),
      formatSetLoad(bodyweight, { weight, reps: '6' }) === '6 reps',
    );
  }
});

test('#4071: the example is what the parser accepts, and the failure message names it', async () => {
  assert.deepEqual(parseVoice(voiceExample(true)), { reps: 6 });
  assert.deepEqual(parseVoice(voiceExample(false)), { weight: 60, reps: 6 });
  const unheard = { ...engine, listen: async () => 'umm' };
  assert.deepEqual(await captureSet(unheard, true), {
    kind: 'message',
    message: `Didn't catch that — try "6 reps"`,
  });
  assert.deepEqual(await captureSet(unheard), {
    kind: 'message',
    message: `Didn't catch that — try "60 kg 6 reps"`,
  });
});

test('#4071: the set card passes the unloaded test to the hint', async () => {
  const card = await readFile(
    new URL('../src/features/workouts/components/SetEntry.tsx', import.meta.url),
    'utf8',
  );
  assert.match(card, /unloaded=\{isUnloadedSet\(exercise, set\)\}/);
});

// --- Rep Max: 0 RM ---

test('#4071: an estimate of 0 or less is no estimate; a real one is unchanged', () => {
  for (const type of ['bodyweight', 'weighted']) {
    assert.equal(oneRmText(0, type), null);
    assert.equal(oneRmText(-3, type), null);
    assert.equal(oneRmText(null, type), null);
  }
  assert.equal(oneRmText(92.5, 'weighted'), '92.5 kg');
  assert.equal(oneRmText(114.5, 'bodyweight'), '5 RM');
});

test('#4071: every mobile screen that draws the label routes the value through oneRmText', async () => {
  const read = (path: string) =>
    readFile(new URL(`../src/features/workouts/${path}`, import.meta.url), 'utf8');
  const header = await read('screens/GuidedWorkoutScreen.tsx');
  assert.match(header, /oneRmText\(exercise\.estimated1rm, exercise\.exerciseType\) \?\? 'Unavailable'/);
  const previous = await read('components/PreviousSession.tsx');
  assert.match(previous, /oneRmText\(exercise\.estimated1rm, exercise\.exerciseType\)/);
  assert.match(previous, /\{rm !== null && \(/);
  const summary = await read('components/ExerciseSummary.tsx');
  assert.match(summary, /isEstimatedOneRm\(exercise\.estimated1rm\)/);
});
