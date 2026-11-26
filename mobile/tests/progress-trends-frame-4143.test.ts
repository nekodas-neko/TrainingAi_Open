import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

// #4143 item 10: the Trends card keeps its chart-sized frame only while it has a chart (or is loading).

test('"Not enough data yet" is not held at the chart frame height', () => {
  const src = readFileSync(
    new URL('../src/features/health/components/ProgressPanel.tsx', import.meta.url),
    'utf8',
  );
  assert.match(src, /const framed = data === null \|\| sufficient;/);
  assert.match(src, /key=\{framed \? 'chart' : 'empty'\}/);
  assert.match(src, /framed\s+\? theme\.sizes\.chartHeight[^:]+:\s+undefined/);
});
