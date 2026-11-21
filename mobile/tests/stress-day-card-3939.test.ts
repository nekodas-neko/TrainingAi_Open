import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { stressSpec } from '../src/features/health/data/models';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

// #3939: the chart says what its levels are made from, so the route's `method` must survive the schema.
test('the stress-day schema keeps method and the moving / asleep spans', () => {
  const body = {
    date: '2026-11-20',
    throughMs: 2,
    series: [{ t: 1, level: -0.6 }],
    method: 'still_hr',
    moving: [{ startMs: 1, endMs: 2 }],
    asleep: [{ startMs: 0, endMs: 1 }],
  };
  const parsed = stressSpec('2026-11-20').schema.parse(body);
  assert.equal(parsed.method, 'still_hr');
  assert.deepEqual(parsed.moving, body.moving);
  assert.deepEqual(parsed.asleep, body.asleep);
});

test('an older server with none of them still parses', () => {
  const parsed = stressSpec('2026-11-20').schema.parse({ date: '2026-11-20', throughMs: null, series: [] });
  assert.equal(parsed.method, undefined);
  assert.equal(parsed.moving, undefined);
});

test('the card names its method, joins with the shared helpers and carries the new caption', () => {
  const card = read('../src/features/health/components/StressDayCard.tsx');
  assert.match(card, /Estimated from heart rate while still/);
  assert.match(card, /From the ring’s stress estimate/);
  assert.match(card, /The dotted stretches join the readings either side, where you were moving\./);
  assert.match(card, /from '@trainingai\/shared\/health\/stress-day-line'/);
  assert.doesNotMatch(card, /Gaps weren’t measured/);
});

// #3935: the heart-rate chart's stress band points up, as the stress chart does.
test('the heart-rate card plots the stress level negated and calls it estimated', () => {
  const card = read('../src/features/health/components/HrDayCard.tsx');
  assert.match(card, /value: 0 - p\.level/);
  assert.match(card, /label: 'Estimated stress'/);
  assert.doesNotMatch(card, /Measured stress/);
});
