import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (path: string) => readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8');

test('Progress cards keep their natural height: the status slot only takes room while active (#2901, #2933)', () => {
  const header = read('features/health/components/HealthResourceHeader.tsx');
  assert.match(header, /status = 'when-active'/);
  assert.match(read('features/progress/StrengthScreen.tsx'), /statusVisible\(strength\)/);
});

test('the Progress exercise rows and the Strength Trend value use the web sizes (#2901)', () => {
  const panel = read('features/health/components/ProgressPanel.tsx');
  assert.match(panel, /variant="strengthRowValue"/);
  assert.match(panel, /variant="strengthRowDelta"/);
  assert.match(read('features/progress/StrengthScreen.tsx'), /variant="trendValue"/);
});

test('the page gradient keeps its last colour underneath, so a tall page never shows the teal app background (#2933)', () => {
  assert.match(read('shared/ui/PageGradient.tsx'), /backgroundColor: base/);
});

test('a Today so far tile\'s unit is regular weight (#2933)', () => {
  assert.match(read('features/health/components/HeartDetails.tsx'), /tone="muted" style=\{\{ fontWeight: '400' \}\}>\s*\{' '\}/);
});
