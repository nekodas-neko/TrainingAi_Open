import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { clockSkipOnDay, dateStrMidnightInTz } from '@trainingai/shared/date-utils';
import { hrDayBuckets, hrTracePoints } from '../src/features/health/data/hr-trace';

const TZ = 'Australia/Sydney';
const dayStart = (day: string) => dateStrMidnightInTz(day, TZ).getTime();
const at = (day: string, h: number, m: number) => new Date(dayStart(day) + (h * 60 + m) * 60_000);
const notRecorded = (points: { label: string }[]) => points.filter((p) => p.label === 'Not recorded');

// #3445: the Day screen's gap test read wall-clock minutes as elapsed ones.
test('the hour a spring-forward day skips is not drawn as Not recorded', () => {
  const skip = clockSkipOnDay(dayStart('2026-10-04'), TZ);
  assert.deepEqual(skip, { fromMin: 120, toMin: 180 });
  // 01:45 then 03:00 on the clock: 15 minutes apart in real time, 75 on the clock face.
  const points = hrTracePoints([{ x: 105, y: 60 }, { x: 180, y: 62 }], skip);
  assert.equal(notRecorded(points).length, 0);
});

test('a real gap across the skipped hour is still marked', () => {
  const skip = clockSkipOnDay(dayStart('2026-10-04'), TZ);
  // 01:00 to 03:30 on the clock is 90 real minutes.
  assert.equal(notRecorded(hrTracePoints([{ x: 60, y: 60 }, { x: 210, y: 62 }], skip)).length, 1);
});

test('other days are unchanged: no skip, and 75 minutes apart is a gap', () => {
  assert.equal(clockSkipOnDay(dayStart('2026-10-05'), TZ), null);
  assert.equal(clockSkipOnDay(dayStart('2027-04-04'), TZ), null); // fall-back day: minutes only step back
  assert.equal(notRecorded(hrTracePoints([{ x: 105, y: 60 }, { x: 180, y: 62 }], null)).length, 1);
});

test('the Home card buckets readings by the clock, so 03:05 on a spring-forward day is minute 185', () => {
  const buckets = hrDayBuckets(
    [{ timestamp: at('2026-10-04', 1, 45).toISOString(), bpm: 60 }, { timestamp: new Date(dayStart('2026-10-04') + 125 * 60_000).toISOString(), bpm: 70 }],
    dayStart('2026-10-04'),
    TZ,
  );
  // Elapsed minute 125 is 03:05 on the clock (the hour from 02:00 to 03:00 does not exist).
  assert.deepEqual(buckets.map((b) => b.x), [100, 180]);
});

test('the Home card keeps a fall-back day\'s repeated hour on the same minutes', () => {
  const start = dayStart('2027-04-04');
  const buckets = hrDayBuckets(
    [{ timestamp: new Date(start + 150 * 60_000).toISOString(), bpm: 60 }, { timestamp: new Date(start + 210 * 60_000).toISOString(), bpm: 64 }],
    start,
    TZ,
  );
  // 02:30 the first time and 02:30 the second time both read minute 150.
  assert.deepEqual(buckets.map((b) => b.x), [150]);
});

// The logic above is only worth anything if the screens hand it the skip. There is no renderer in the
// mobile suite, so read the call sites.
test('the Home card and the Day screen pass the skipped hour to hrTracePoints', () => {
  const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');
  const card = read('../src/features/health/components/HrDayCard.tsx');
  assert.match(card, /clockSkipOnDay\(\s*midnight,\s*timezone\s*\)/);
  assert.match(card, /hrTracePoints\(\s*buckets,\s*skip\s*\)/);
  const screen = read('../src/features/health/screens/HealthDayScreen.tsx');
  assert.match(screen, /clockSkipOnDay\(\s*dateStrMidnightInTz\(date,\s*timezone\)\.getTime\(\),\s*timezone\s*\)/);
  assert.match(screen, /^\s*skip,$/m);
});
