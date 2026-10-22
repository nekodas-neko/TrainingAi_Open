import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { sizes } from '../src/shared/theme/tokens.ts';

// #3248: a control may draw smaller than the 48 floor only if it carries hitSlop for the difference.
test('a segmented cell draws at the control size and keeps a touch-target hit area', async () => {
  assert.ok(sizes.control < sizes.touchTarget);
  const source = await readFile(
    new URL('../src/shared/ui/SegmentedControl.tsx', import.meta.url),
    'utf8',
  );
  assert.match(source, /minHeight: theme\.sizes\.control/);
  assert.match(source, /hitSlop=\{\{[^}]*touchTarget - theme\.sizes\.control/s);
});

test('the metric value row keeps a touch-target hit area through hitSlop', async () => {
  assert.ok(sizes.metricValue < sizes.touchTarget);
  const source = await readFile(new URL('../src/shared/ui/MetricCard.tsx', import.meta.url), 'utf8');
  assert.match(source, /hitSlop=\{\{[^}]*touchTarget - theme\.sizes\.metricValue/s);
});
