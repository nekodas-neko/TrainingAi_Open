import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { OFF_ATTRIBUTION } from '@trainingai/shared/nutrition/open-food-facts';
import { isHandoffDebugBuild } from '../src/integrations/app-handoff/debug-builds.ts';

const about = await readFile(
  new URL('../src/features/settings/screens/AboutScreen.tsx', import.meta.url),
  'utf8',
);

test('About renders the shared Open Food Facts credit, not its own copy of the wording', () => {
  assert.match(about, /from '@trainingai\/shared\/nutrition\/open-food-facts'/);
  assert.match(about, /\{OFF_ATTRIBUTION\}/);
  assert.doesNotMatch(about, /Open Database Licence|CC BY-SA/);
  assert.match(OFF_ATTRIBUTION, /Open Database Licence/);
  assert.match(OFF_ATTRIBUTION, /CC BY-SA 3\.0/);
});

test('About lists the latest changelog entry', () => {
  assert.match(about, /CHANGELOG\[0\]\.changes\.map/);
});

test('the hand-off test card shows only in the Dev build', () => {
  assert.equal(isHandoffDebugBuild('com.trainingai.app.dev'), true);
  assert.equal(isHandoffDebugBuild('com.trainingai.app'), false);
  assert.equal(isHandoffDebugBuild('com.trainingai.app.preview'), false);
  assert.equal(isHandoffDebugBuild(undefined), false);
  assert.equal(isHandoffDebugBuild(null), false);
});
