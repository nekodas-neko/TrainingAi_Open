import assert from 'node:assert/strict';
import test from 'node:test';

import { updatesStripLabel } from '../src/features/home/data/updates-strip.ts';

// #4143 item 1: the closed strip names its one entry, or counts several.

test('one update shows its own label, ready or failed', () => {
  assert.equal(updatesStripLabel([{ label: 'Week in review ready' }]), 'Week in review ready');
  assert.equal(
    updatesStripLabel([{ label: 'Week in review couldn’t load' }]),
    'Week in review couldn’t load',
  );
});

test('several updates are counted', () => {
  assert.equal(updatesStripLabel([{ label: 'a' }, { label: 'b' }]), '2 updates');
  assert.equal(updatesStripLabel([{ label: 'a' }, { label: 'b' }, { label: 'c' }]), '3 updates');
});
