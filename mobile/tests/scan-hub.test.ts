import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ScanHub, type NativeScan } from '../src/integrations/ble/scan-hub.ts';
import type { FoundDevice } from '../src/integrations/ble/types.ts';

const HR = '0000180d-0000-1000-8000-00805f9b34fb';
const SCALE = '0000ffe0-0000-1000-8000-00805f9b34fb';

function fakeNative() {
  const log: string[] = [];
  let running: {
    services: string[];
    lowLatency: boolean;
    emit: (device: FoundDevice & { services: string[] | null }) => void;
    fail: (message: string) => void;
  } | null = null;
  const native: NativeScan = {
    start(services, lowLatency, onDevice, onError) {
      log.push(`start ${services.join(',')}${lowLatency ? ' low-latency' : ''}`);
      running = { services, lowLatency, emit: onDevice, fail: onError };
    },
    stop() {
      log.push('stop');
      running = null;
    },
  };
  return {
    native,
    log,
    emit: (id: string, services: string[] | null) =>
      running?.emit({ id, name: id, rssi: -60, services }),
    fail: (message: string) => running?.fail(message),
    get running() {
      return running !== null;
    },
  };
}

test('a strap scan and the scale’s listen scan share the scanner, and neither ends the other', () => {
  const fake = fakeNative();
  const hub = new ScanHub(fake.native);
  const scale: string[] = [];
  const strap: string[] = [];
  const stopScale = hub.add(
    SCALE,
    (d) => scale.push(d.id),
    () => {},
    true,
  );
  assert.equal(fake.log.at(-1), `start ${SCALE} low-latency`);
  const stopStrap = hub.add(
    HR,
    (d) => strap.push(d.id),
    () => {},
  );
  assert.equal(fake.log.at(-1), `start ${SCALE},${HR} low-latency`, 'one scan for both');

  fake.emit('S1', [SCALE]);
  fake.emit('H1', [HR]);
  assert.deepEqual(scale, ['S1']);
  assert.deepEqual(strap, ['H1']);

  // The strap scan ends: the scale keeps listening, at low latency, with the strap filter gone.
  stopStrap();
  assert.equal(fake.running, true);
  assert.equal(fake.log.at(-1), `start ${SCALE} low-latency`);
  fake.emit('H2', [HR]);
  fake.emit('S2', [SCALE]);
  assert.deepEqual(strap, ['H1'], 'a stopped listener hears nothing more');
  assert.deepEqual(scale, ['S1', 'S2']);

  // And the other way: the scale stops while a strap scan runs, which drops back to balanced mode.
  const stopStrapAgain = hub.add(
    HR,
    (d) => strap.push(d.id),
    () => {},
  );
  stopScale();
  assert.equal(fake.log.at(-1), `start ${HR}`);
  stopStrapAgain();
  assert.equal(fake.running, false, 'the last listener leaving stops the scan');
  stopStrapAgain();
  assert.equal(fake.log.at(-1), 'stop', 'stopping twice changes nothing');
});

test('a scan record that names no services is only attributed when one service is wanted', () => {
  const fake = fakeNative();
  const hub = new ScanHub(fake.native);
  const seen: string[] = [];
  hub.add(
    SCALE,
    (d) => seen.push(d.id),
    () => {},
  );
  fake.emit('A', null);
  assert.deepEqual(seen, ['A']);
  hub.add(
    HR,
    () => seen.push('strap'),
    () => {},
  );
  fake.emit('B', null);
  assert.deepEqual(seen, ['A'], 'ambiguous with two services, so nobody is told');
});

test('service ids are compared without regard to case', () => {
  const fake = fakeNative();
  const hub = new ScanHub(fake.native);
  const seen: string[] = [];
  hub.add(
    SCALE.toUpperCase(),
    (d) => seen.push(d.id),
    () => {},
  );
  fake.emit('A', [SCALE]);
  assert.deepEqual(seen, ['A']);
});

test('a scan error reaches every listener once and clears the hub', () => {
  const fake = fakeNative();
  const hub = new ScanHub(fake.native);
  const errors: string[] = [];
  hub.add(
    SCALE,
    () => {},
    (m) => errors.push(`scale ${m}`),
  );
  hub.add(
    HR,
    () => {},
    (m) => errors.push(`strap ${m}`),
  );
  fake.fail('scan failed');
  assert.deepEqual(errors, ['scale scan failed', 'strap scan failed']);
  assert.equal(fake.running, false);
  // A listener added afterwards starts a fresh scan.
  hub.add(
    HR,
    () => {},
    () => {},
  );
  assert.equal(fake.running, true);
});
