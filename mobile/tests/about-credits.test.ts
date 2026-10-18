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

test('About source is valid UTF-8 and prints the what\u2019s-new heading and bullet intact (#3031)', async () => {
  const bytes = await readFile(
    new URL('../src/features/settings/screens/AboutScreen.tsx', import.meta.url),
  );
  // fatal decoding throws on a stray Windows-1252 byte such as 0x92, which shows as U+FFFD
  assert.doesNotThrow(() => new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  assert.ok(!about.includes('\uFFFD'));
  assert.match(about, />What\u2019s new in v\{CHANGELOG\[0\]\.version\}</);
  assert.match(about, /\n\s+\u00B7 \{change\}\n/);
});

test('every mobile source and test file is valid UTF-8 with no BOM (#3031)', async () => {
  const { readdir } = await import('node:fs/promises');
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const bad: string[] = [];
  for (const dir of ['../src/', './']) {
    const root = new URL(dir, import.meta.url);
    for (const entry of await readdir(root, { recursive: true })) {
      if (!/\.(ts|tsx)$/.test(entry)) continue;
      const bytes = await readFile(new URL(entry, root));
      try {
        decoder.decode(bytes);
        if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) bad.push(`${entry} (BOM)`);
      } catch {
        bad.push(entry);
      }
    }
  }
  assert.deepEqual(bad, []);
});
