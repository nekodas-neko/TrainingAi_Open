import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { STRENGTH_BAR_CAPTION } from '../src/features/health/progressPresentation.ts';

// #4143 item 9: one caption explains the strength bars' marks.

test('the caption says what the bar is and where the marks are', () => {
  assert.equal(
    STRENGTH_BAR_CAPTION,
    "Bar: today's lift as a share of your best. Marks at 60% and 80%.",
  );
});

test('the strength card prints it once, above the groups', () => {
  const src = readFileSync(
    new URL('../src/features/health/components/ProgressPanel.tsx', import.meta.url),
    'utf8',
  );
  assert.equal((src.match(/\{STRENGTH_BAR_CAPTION\}/g) ?? []).length, 1);
});
