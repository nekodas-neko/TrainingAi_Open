import test from 'node:test';
import assert from 'node:assert/strict';
import { fallbackNoteFor, readPacer } from '@trainingai/shared/walking/walk-pacer';
import {
  CadenceMeter,
  WalkPace,
  cadenceStatusOf,
  paceSignals,
} from '../src/features/activities/data/walk-pace.ts';
import { cadenceReadout, wantsLiveCadence } from '../src/features/activities/data/live-cadence.ts';
import { liveHrView } from '../src/features/devices/strap/labels.ts';
import type { StrapState } from '../src/features/devices/strap/StrapSession.ts';

const running = { mode: 'active', pauseStartMs: null as number | null };
const strapState = (over: Partial<StrapState>) =>
  ({
    paired: { id: 'x' },
    link: 'connected',
    accel: 'off',
    bpm: null,
    bpmAt: null,
    worn: true,
    trace: [],
    ...over,
  }) as unknown as StrapState;

test('the live cadence readout shows on walk, run, hike, treadmill and the guided walk only', () => {
  for (const id of ['walk', 'run', 'hike', 'treadmill'])
    assert.equal(wantsLiveCadence({ ...running, type: { id } }), true, id);
  assert.equal(wantsLiveCadence({ ...running, type: { id: 'walk' }, guidance: { kind: 'walk' } }), true);
  // Not for a cycle or swim (distance-based, no step rate), a gym session, or a fitness test.
  for (const id of ['cycle', 'swim', 'hiit', 'strength'])
    assert.equal(wantsLiveCadence({ ...running, type: { id } }), false, id);
  assert.equal(wantsLiveCadence({ ...running, type: { id: 'run' }, guidance: { kind: 'test' } }), false);
});

test('the readout stops asking while paused, before the start and once done', () => {
  const type = { id: 'treadmill' };
  assert.equal(wantsLiveCadence({ mode: 'active', pauseStartMs: 5, type }), false);
  assert.equal(wantsLiveCadence({ mode: 'pre', pauseStartMs: null, type }), false);
  assert.equal(wantsLiveCadence({ mode: 'done', pauseStartMs: null, type }), false);
});

test('the cadence line is a whole number, or says why there is none', () => {
  assert.deepEqual(cadenceReadout({ link: 'connected', accel: 'streaming' }, 112.6), { spm: 113 });
  assert.deepEqual(cadenceReadout({ link: 'connected', accel: 'starting' }, null), { waiting: 'Reading your steps…' });
  assert.deepEqual(cadenceReadout({ link: 'connected', accel: 'streaming' }, null), { waiting: 'Reading your steps…' });
  assert.match((cadenceReadout({ link: 'connected', accel: 'unavailable' }, null) as { waiting: string }).waiting, /isn’t sending step data/);
});

test('the meter and the pacer derive the same cadence from the same batches', () => {
  const samples = Array.from({ length: 8 * 50 }, (_, i) => Math.round(1000 + 300 * Math.sin((2 * Math.PI * 2 * i) / 50)));
  const meter = new CadenceMeter();
  const pace = new WalkPace(0, {});
  for (let s = 0; s < 8; s++) {
    const batch = { magnitudes: samples.slice(s * 50, (s + 1) * 50), sampleRate: 50, at: (s + 1) * 1000 };
    meter.push(batch);
    pace.onBatch(batch);
  }
  assert.ok(meter.live(8_000) !== null);
  assert.equal(meter.live(8_000), pace.live(8_000));
  meter.reset();
  assert.equal(meter.live(8_000), null);
});

test('the fallback note follows the strap: none, reading, unavailable', () => {
  assert.match(fallbackNoteFor('hr', 'none')!, /Wear the strap for step pacing/);
  assert.match(fallbackNoteFor('hr')!, /Wear the strap for step pacing/, 'absent reads as no strap');
  assert.match(fallbackNoteFor('hr', 'reading')!, /^Reading your steps…/);
  assert.doesNotMatch(fallbackNoteFor('hr', 'reading')!, /Wear the strap/);
  const refused = fallbackNoteFor('speed', 'unavailable')!;
  assert.match(refused, /isn’t sending step data/);
  assert.match(refused, /another app/);
  assert.equal(fallbackNoteFor('cadence', 'reading'), null);
  const reading = readPacer({
    kind: 'fast',
    cadenceSpm: null,
    speedKmh: null,
    bpm: 110,
    cadenceTargets: { fast: 120, slow: 95 },
    speedTargets: null,
    hrTargets: { fast: 101, fastMax: 118, slow: 90 } as never,
    cadenceStatus: 'reading',
  });
  assert.match(reading!.fallbackNote!, /^Reading your steps…/);
});

test('the strap state maps to a cadence status', () => {
  assert.equal(cadenceStatusOf(null), 'none');
  assert.equal(cadenceStatusOf(strapState({ paired: null })), 'none');
  assert.equal(cadenceStatusOf(strapState({ accel: 'starting' })), 'reading');
  assert.equal(cadenceStatusOf(strapState({ accel: 'streaming' })), 'reading');
  assert.equal(cadenceStatusOf(strapState({ accel: 'unavailable' })), 'unavailable');
  assert.equal(cadenceStatusOf(strapState({ accel: 'starting', link: 'waiting' })), 'none');
  const signals = paceSignals({ route: [], treadmill: true, strap: strapState({ accel: 'starting' }), nowMs: 0 });
  assert.equal(signals.cadenceStatus, 'reading');
});

test('live bpm is a whole number', () => {
  const at = 1_000;
  const state = strapState({
    bpm: 93.5,
    bpmAt: at,
    trace: [
      { at: 400, bpm: 93 },
      { at: 600, bpm: 94 },
      { at: 800, bpm: 93 },
      { at: 1_000, bpm: 94 },
    ],
  });
  // A median of two middles would be 93.5; the view model hands the screen 94 or 93, never a half.
  const view = liveHrView(state, at, null, null);
  assert.ok(Number.isInteger(view.bpm));
  assert.ok(view.points.every((p) => Number.isInteger(p.bpm)));
  assert.equal(liveHrView({ ...state, trace: [] }, at, null, null).bpm, 94, 'the raw fallback rounds too');
});
