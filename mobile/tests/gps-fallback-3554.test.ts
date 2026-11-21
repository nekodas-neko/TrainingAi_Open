import test from 'node:test';
import assert from 'node:assert/strict';
import { speedTargetsFromHistory, walkHrTargets, STOPPED_KMH } from '@trainingai/shared/walking/walk-pacer';
import { gpsSpeedForPacing } from '../src/features/activities/data/gps-fallback.ts';
import { WalkPace } from '../src/features/activities/data/walk-pace.ts';
import { defaultWalk, walkPlan } from '../src/features/activities/data/guidance.ts';

test('GPS moving: the speed is kept, with or without heart rate', () => {
  assert.equal(gpsSpeedForPacing({ speedKmh: 5.5, cadenceSpm: null, bpm: 100 }), 5.5);
  assert.equal(gpsSpeedForPacing({ speedKmh: 5.5, cadenceSpm: null, bpm: null }), 5.5);
  assert.equal(gpsSpeedForPacing({ speedKmh: STOPPED_KMH, cadenceSpm: null, bpm: 100 }), STOPPED_KMH);
});

test('GPS still with heart rate: the speed is withheld so heart rate paces', () => {
  assert.equal(gpsSpeedForPacing({ speedKmh: 0.2, cadenceSpm: null, bpm: 100 }), null);
  assert.equal(gpsSpeedForPacing({ speedKmh: 0, cadenceSpm: null, bpm: 100 }), null);
});

test('GPS still without heart rate: the speed stays, so a real stop reads Stopped', () => {
  assert.equal(gpsSpeedForPacing({ speedKmh: 0.2, cadenceSpm: null, bpm: null }), 0.2);
});

test('GPS back: the speed returns the moment it moves again', () => {
  assert.equal(gpsSpeedForPacing({ speedKmh: 0.2, cadenceSpm: null, bpm: 100 }), null);
  assert.equal(gpsSpeedForPacing({ speedKmh: 5.1, cadenceSpm: null, bpm: 100 }), 5.1);
});

test('no speed stays no speed, and strap cadence leaves the speed alone', () => {
  assert.equal(gpsSpeedForPacing({ speedKmh: null, cadenceSpm: null, bpm: 100 }), null);
  assert.equal(gpsSpeedForPacing({ speedKmh: 0.2, cadenceSpm: 110, bpm: 100 }), 0.2);
});

const config = { ...defaultWalk, sets: 1, fastSec: 60, slowSec: 60 };
const [, fastBlock] = walkPlan(config).segments;
const pace = () => {
  const p = new WalkPace(0, config);
  p.setTargets({
    speed: speedTargetsFromHistory({
      fast: { avgPaceSecPerKm: 600, count: 5 },
      slow: { avgPaceSecPerKm: 900, count: 5 },
    }),
    hr: walkHrTargets(168, 55),
  });
  return p;
};

test('the pacer reads heart rate instead of Stopped when the phone has not moved', () => {
  const onTreadmill = pace().reading(0, fastBlock, { speedKmh: 0.1, bpm: 110 })!;
  assert.equal(onTreadmill.signal, 'hr');
  assert.notEqual(onTreadmill.band, 'stopped');
  const standing = pace().reading(0, fastBlock, { speedKmh: 0.1, bpm: null })!;
  assert.equal(standing.signal, 'speed');
  assert.equal(standing.band, 'stopped');
  assert.equal(pace().reading(0, fastBlock, { speedKmh: 6.5, bpm: 110 })!.signal, 'speed', 'GPS back');
});

test('a heart rate with no targets cannot take over from the speed', () => {
  const p = new WalkPace(0, config);
  p.setTargets({ speed: speedTargetsFromHistory({ fast: { avgPaceSecPerKm: 600, count: 5 }, slow: { avgPaceSecPerKm: 900, count: 5 } }), hr: null });
  assert.equal(p.reading(0, fastBlock, { speedKmh: 0.1, bpm: 110 })!.band, 'stopped');
});
