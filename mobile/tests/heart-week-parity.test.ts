import assert from 'node:assert/strict';
import { test } from 'node:test';
import { trendCardTitle } from '../src/features/health/data/heart-view.ts';
import {
  flowDigest,
  trainingHeadline,
  volumeTickLabel,
} from '../src/features/health/data/week-view.ts';

test('a 14-day heart card is titled with its window', () => {
  assert.equal(trendCardTitle('HR Recovery (60s drop)'), 'HR Recovery (60s drop) — 14 days');
});

test('the Training headline groups thousands and agrees with the session count', () => {
  assert.deepEqual(trainingHeadline(21354.4, 5), { value: '21,354', caption: 'kg over 5 sessions' });
  assert.deepEqual(trainingHeadline(980, 1), { value: '980', caption: 'kg over 1 session' });
  assert.deepEqual(trainingHeadline(0, 0), { value: '0', caption: 'kg over 0 sessions' });
});

test('the training chart writes thousands as 4k / 2k over a bare 0', () => {
  assert.deepEqual([4000, 2000, 0].map(volumeTickLabel), ['4k', '2k', '0']);
  assert.equal(volumeTickLabel(12500), '13k');
});

test('the digest flows bullets and headings into one paragraph', () => {
  assert.equal(
    flowDigest('## Week\n- You trained **5** times.\n\n* Sleep held at 7 h.\n• HRV rose.'),
    'Week You trained **5** times. Sleep held at 7 h. HRV rose.',
  );
  assert.equal(flowDigest('One line.'), 'One line.');
  assert.equal(flowDigest(''), '');
});
