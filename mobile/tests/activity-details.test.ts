import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { activityZoneModel } from '../src/features/health/data/activity-zones.ts';

// The component needs a device to render (the suite has no renderer), so the order and the memo
// keys are read from the source, as the other parity guards do; the zone maths runs for real.
const source = readFile(
  new URL('../src/features/health/components/ActivityDetails.tsx', import.meta.url),
  'utf8',
);

test('the detail runs HR chart, Time in Zone, Route, Splits, as the current app does (#3172)', async () => {
  const text = await source;
  const at = (needle: string) => {
    const index = text.indexOf(needle);
    assert.notEqual(index, -1, `${needle} is rendered`);
    return index;
  };
  const order = ['title="Heart Rate & Pace"', 'Time in Zone', '<RouteMap', '>\n            Splits'].map(at);
  assert.deepEqual(order, [...order].sort((a, b) => a - b));
});

test('a chart scrub does not recompute the zones (#3172)', async () => {
  const text = await source;
  const memo = text.match(/useMemo\(\s*\(\) =>\s*activityZoneModel\(\{[\s\S]*?\}\),\s*\[([^\]]*)\]/);
  assert.ok(memo, 'the zone model is memoised');
  assert.doesNotMatch(memo[1], /scrub/, 'the scrub point is not a key');
  assert.match(memo[1], /readings/);
  assert.doesNotMatch(text, /const zoneSegments =|zoneBreakdownFromReadings\(/, 'no per-render zone work left in the component');
  assert.match(text, /const readings = useMemo\(/, 'a fresh readings array every render would defeat the memo');
});

test('the scrub dot clears when the touch ends (#3172)', async () => {
  assert.match(await source, /onRelease=\{[^}]*setScrubPoint\(null\)/);
  assert.match(
    await readFile(new URL('../src/shared/ui/LineChart.tsx', import.meta.url), 'utf8'),
    /onResponderRelease=\{\(\) => onRelease\?\.\(\)\}[\s\S]*onResponderTerminate=\{\(\) => onRelease\?\.\(\)\}/,
  );
});

test('the zone model yields time in zone and route segments only when it has what they need', () => {
  const readings = Array.from({ length: 10 }, (_, i) => ({
    timestamp: new Date(Date.UTC(2026, 9, 12, 2, i)).toISOString(),
    bpm: 120 + i,
  }));
  const base = { readings, routePoints: [], paceSeries: [], start: Date.UTC(2026, 9, 12, 2), end: null };
  const full = activityZoneModel({ ...base, maxHr: 190, restingHr: 55 });
  assert.ok(full.zones && full.zones.totalSec > 0);
  assert.deepEqual(activityZoneModel({ ...base, maxHr: null, restingHr: 55 }), { zones: null, zoneSegments: null });
  assert.equal(activityZoneModel({ ...base, maxHr: 190, restingHr: 55, readings: readings.slice(0, 1) }).zones, null);
});
