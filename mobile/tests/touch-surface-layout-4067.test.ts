import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { splitTouchSurfaceStyle } from '../src/shared/ui/touchSurfaceLayout.ts';

// React Native cannot load in this runner, so the layout rule is tested as a pure function and the
// screens are read as text.
const source = (path: string) => readFile(new URL(`../src/${path}`, import.meta.url), 'utf8');

test("a row's flex: 1 lands on the wrapper that is the row's child, not on the Pressable inside (#4067)", () => {
  // The AI Periodization row: TouchSurface style={{ flex: 1, minWidth: 0 }} inside a row Stack.
  const { outer, inner } = splitTouchSurfaceStyle({ flex: 1, minWidth: 0 });
  assert.deepEqual(outer, { flexGrow: 1, flexShrink: 1, minWidth: 0 });
  assert.deepEqual(inner, {});
});

test('the flex shorthand never leaves a zero basis on the wrapper', () => {
  assert.equal('flexBasis' in splitTouchSurfaceStyle({ flex: 1 }).outer, false);
  assert.deepEqual(splitTouchSurfaceStyle({ flex: 0 }).outer, { flexGrow: 0, flexShrink: 0 });
  assert.deepEqual(splitTouchSurfaceStyle({ flex: -1 }).outer, { flexGrow: 0, flexShrink: 1 });
  // A later explicit key wins, as in React Native.
  assert.equal(splitTouchSurfaceStyle([{ flex: 1 }, { flexGrow: 3 }]).outer.flexGrow, 3);
});

test('placement keys go to the wrapper; look and size keys stay on the Pressable', () => {
  const { outer, inner } = splitTouchSurfaceStyle([
    { padding: 12, backgroundColor: '#123', minHeight: 48 },
    null,
    { alignSelf: 'flex-start', marginTop: 4, width: 120 },
  ]);
  assert.deepEqual(outer, { alignSelf: 'flex-start', marginTop: 4, width: 120 });
  assert.deepEqual(inner, { padding: 12, backgroundColor: '#123', minHeight: 48 });
  assert.deepEqual(splitTouchSurfaceStyle(undefined), { outer: {}, inner: {} });
});

test('TouchSurface routes the split to the wrapper and the Pressable (#4067)', async () => {
  const text = await source('shared/ui/TouchSurface.tsx');
  assert.match(text, /splitTouchSurfaceStyle\(style\)/);
  assert.match(text, /<Animated\.View style=\{\[\{ transform: \[\{ scale \}\], flexGrow: fill \? 1 : 0 \}, split\?\.outer\]\}>/);
  assert.match(text, /style=\{innerStyle\}/);
});

test('the AI Periodization row is a row: icon, one-line name, phase line and recency, all rendered', async () => {
  const text = await source('features/health/components/TrainingPanel.tsx');
  const row = text.slice(text.indexOf('overview.data?.sessions.map'), text.indexOf('priorData.error &&'));
  // Outer row holds the touch surface and the optional button; the inner row holds the content.
  assert.equal((row.match(/<Stack\s+direction="row"/g) ?? []).length + (row.match(/<Stack key=\{session\.sessionId\} direction="row"/g) ?? []).length, 2);
  assert.match(row, /style=\{\{ flex: 1, minWidth: 0 \}\}/);
  assert.match(row, /<AppText variant="label" numberOfLines=\{1\}>\s*\{session\.sessionName\}/);
  assert.match(row, /\{row\.label\}/);
  assert.match(row, /\{row\.recency\}/);
  assert.match(row, /accessibilityLabel=\{`\$\{session\.sessionName\}, \$\{row\.label\}`\}/);
});
