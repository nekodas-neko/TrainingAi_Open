import assert from 'node:assert/strict';
import { test } from 'node:test';
import { gainTone } from '@trainingai/shared/health/strength-progress';
import {
  muscleLegendItems,
  muscleVolumeCaption,
} from '../src/features/health/data/training-view.ts';
import { gainColor } from '../src/features/health/progressPresentation.ts';
import { moreCopy } from '../src/features/settings/data/profile.ts';
import { compactToggleLayout } from '../src/shared/ui/compactToggleLayout.ts';
import { stackCalendarTitle } from '../src/shared/ui/monthGrid.ts';
import { sizes, spacing } from '../src/shared/theme/tokens.ts';

// Behaviour of the pure helpers behind the parity round for #2934, #2900, #2901 and #2902. What a
// component draws needs a device, so the phone re-check on each issue covers that.

test('the muscle volume card names its scale at the right of the title (#2900)', () => {
  assert.equal(muscleVolumeCaption([{ target: 12 }, { target: null }]), 'vs your program target');
  assert.equal(muscleVolumeCaption([{ target: null }]), 'Target: 10–20 sets');
});

test('the muscle key names the three bands, then Not trained as an outlined square (#2900)', () => {
  const colors = { bad: 'r', warn: 'a', good: 'g', untrained: 'u' };
  assert.deepEqual(muscleLegendItems(true, colors), [
    { label: 'Under 60%', color: 'r', shape: 'square' },
    { label: '60–99%', color: 'a', shape: 'square' },
    { label: 'At target', color: 'g', shape: 'square' },
    { label: 'Not trained', color: 'u', shape: 'square', outlined: true },
  ]);
});

test('without targets the key points at the bars instead of naming bands (#2900)', () => {
  const items = muscleLegendItems(false, { bad: 'r', warn: 'a', good: 'g', untrained: 'u' });
  assert.deepEqual(
    items.map((item) => item.label),
    ['Colours match the bars below', 'Not trained'],
  );
  assert.equal(items[0].shape, 'text');
  assert.equal(items[0].color, undefined);
});

test('a title-row toggle keeps a full touch target in every cell (#2901)', () => {
  for (const appearance of ['tint', 'pill'] as const) {
    assert.equal(compactToggleLayout(sizes, spacing, appearance).cellMinHeight, 48, appearance);
  }
  assert.equal(compactToggleLayout(sizes, spacing, 'pill').trackPadding, spacing.xxs);
  assert.equal(compactToggleLayout(sizes, spacing, 'tint').trackPadding, 0);
});

test('a gain reads up, down or flat from the shared rule, and colours from the status tokens (#2901)', () => {
  assert.deepEqual([5, -2, 0, null, undefined].map(gainTone), ['up', 'down', 'flat', null, null]);
  const status = { success: 'green', danger: 'red', warning: 'amber' };
  assert.equal(gainColor(5, status), 'green');
  assert.equal(gainColor(-2, status), 'red');
  assert.equal(gainColor(0, status), 'amber');
  assert.equal(gainColor(null, status), null);
});

test('the calendar title moves above its controls once text outgrows the shared row (#2900)', () => {
  assert.equal(stackCalendarTitle(1), false);
  assert.equal(stackCalendarTitle(1.1), false);
  assert.equal(stackCalendarTitle(1.15), true);
  assert.equal(stackCalendarTitle(1.3), true);
});

test('More words its rows and actions as the current app does (#2902)', () => {
  assert.equal(moreCopy.goals.title, 'Goals');
  assert.equal(moreCopy.goals.subtitle, 'Activity level, targets & AI recommendations');
  assert.equal(moreCopy.year.action, 'View →');
  assert.deepEqual(moreCopy.actions, {
    report: 'Report an Issue',
    edit: 'Edit Profile',
    signOut: 'Sign Out',
  });
});
