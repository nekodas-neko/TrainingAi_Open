import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { sheetBack } from '../src/shared/ui/sheetBack.ts';

// Android Back from Edit meal used to close the whole meal library, because the sheet's Back always
// dismissed it. With the editor open it must close the editor only; Back again closes the library.

const src = resolve(import.meta.dirname, '..', 'src');

test('a sheet with an inner step steps out on Back and stays open', () => {
  const calls: string[] = [];
  sheetBack(
    () => calls.push('editor closed'),
    () => calls.push('sheet dismissed'),
  )();
  assert.deepEqual(calls, ['editor closed']);
});

test('a sheet without an inner step still dismisses on Back', () => {
  const calls: string[] = [];
  sheetBack(undefined, () => calls.push('sheet dismissed'))();
  assert.deepEqual(calls, ['sheet dismissed']);
});

test('Back order in the meal library: editor first, then the library', () => {
  let editor: string | null = 'meal-1';
  let libraryOpen = true;
  // Mirrors RecipesSheet: onBack is set only while the editor is open.
  const back = () =>
    sheetBack(editor ? () => (editor = null) : undefined, () => (libraryOpen = false))();
  back();
  assert.equal(editor, null);
  assert.equal(libraryOpen, true);
  back();
  assert.equal(libraryOpen, false);
});

test('RecipesSheet and Sheet are wired to that behaviour', async () => {
  const recipes = await readFile(resolve(src, 'features/nutrition/components/RecipesSheet.tsx'), 'utf8');
  assert.match(recipes, /onBack=\{editor \? \(\) => setEditor\(null\) : undefined\}/);
  const sheet = await readFile(resolve(src, 'shared/ui/Sheet.tsx'), 'utf8');
  assert.match(sheet, /onRequestClose=\{sheetBack\(onBack, \(\) => dismiss\(\)\)\}/);
});
