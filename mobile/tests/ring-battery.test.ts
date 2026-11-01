import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_RING_ALERT,
  checkRingAlert,
  chargeTimeText,
  clearRingAlertFired,
  daysLeftText,
  drainChart,
  parseRingAlert,
  readingAge,
} from '../src/features/devices/data/ring-battery.ts';
import { ringBatterySpec } from '../src/features/health/data/body-models.ts';

const reading = (percent: number, over: Partial<{ charging: boolean; ageMinutes: number }> = {}) => ({
  percent,
  charging: false,
  ageMinutes: 10,
  ...over,
});

test('the alert fires once per low spell at the owner’s level, and re-arms 5 points above it', () => {
  let settings = { ...DEFAULT_RING_ALERT, level: 20 };
  let verdict = checkRingAlert(settings, reading(19));
  assert.equal(verdict.notify, true);
  settings = verdict.settings;
  assert.equal(checkRingAlert(settings, reading(12)).notify, false);
  settings = checkRingAlert(settings, reading(100, { charging: true })).settings;
  assert.equal(settings.fired, false);
  assert.equal(checkRingAlert(settings, reading(18)).notify, true);
});

test('a reading over a day old, or none, never alerts', () => {
  assert.equal(checkRingAlert(DEFAULT_RING_ALERT, reading(5, { ageMinutes: 25 * 60 })).notify, false);
  assert.equal(checkRingAlert(DEFAULT_RING_ALERT, null).notify, false);
});

test('switched off, the alert stays quiet and an open spell alerts once when switched on', () => {
  const off = { ...DEFAULT_RING_ALERT, enabled: false };
  const verdict = checkRingAlert(off, reading(10));
  assert.equal(verdict.notify, false);
  assert.equal(verdict.settings.fired, false);
  assert.equal(checkRingAlert({ ...verdict.settings, enabled: true }, reading(10)).notify, true);
});

test('saved alert settings that are missing or damaged read as the defaults', () => {
  assert.deepEqual(parseRingAlert(null), DEFAULT_RING_ALERT);
  assert.deepEqual(parseRingAlert('not json'), DEFAULT_RING_ALERT);
  assert.deepEqual(parseRingAlert('{"enabled":false,"level":15}'), { enabled: false, level: 15, fired: false });
});

test('the reading’s age, days left and charge time read in plain words', () => {
  assert.equal(readingAge(1), 'just now');
  assert.equal(readingAge(14), '14 min ago');
  assert.equal(readingAge(180), '3 h ago');
  assert.equal(readingAge(3 * 1440), '3 days ago');
  assert.equal(daysLeftText(0.4), 'less than a day');
  assert.equal(daysLeftText(1.2), '1 day');
  assert.equal(daysLeftText(2.6), '3 days');
  assert.equal(chargeTimeText(4200), '1h 10m');
});

test('the drain chart names each month under its first point', () => {
  const { points, axisLabels } = drainChart([
    { day: '2026-07-30', drainPct: 18 },
    { day: '2026-07-31', drainPct: 19 },
    { day: '2026-08-01', drainPct: 20 },
  ]);
  assert.deepEqual(axisLabels, ['Jul', '', 'Aug']);
  assert.equal(points[2].value, 20);
  assert.ok(points[1].x > points[0].x);
});

test('the battery resource reads the server’s answer and tolerates a missing series', () => {
  const parsed = ringBatterySpec.schema.parse({
    latest: { percent: 64, charging: false, tsMs: 1, ageMinutes: 14 },
    drainPerDayPct: 19,
    daysLeft: 3.1,
    daysBetweenCharges: null,
    avgChargeSec: null,
    lastChargedMs: null,
  });
  assert.equal(parsed.latest?.percent, 64);
  assert.deepEqual(parsed.series, []);
  assert.equal(ringBatterySpec.schema.parse({ latest: null }).latest, null);
});

test('closing the open spell for a new owner keeps the chosen level and switch (#3435)', () => {
  const saved = JSON.stringify({ enabled: false, level: 30, fired: true });
  assert.deepEqual(JSON.parse(clearRingAlertFired(saved)!), { enabled: false, level: 30, fired: false });
  assert.equal(clearRingAlertFired(null), null);
  // The next account's first low reading alerts again.
  const settings = parseRingAlert(clearRingAlertFired(JSON.stringify({ ...DEFAULT_RING_ALERT, fired: true })));
  assert.equal(checkRingAlert(settings, reading(10)).notify, true);
});
