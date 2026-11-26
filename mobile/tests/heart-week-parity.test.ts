import { parseMarkdown } from '../src/shared/ui/markdown-model.ts';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { trendCardTitle } from '../src/features/health/data/heart-view.ts';
import {
  digestLines,
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
  // A light week keeps plain numbers rather than 0k / 1k / 1k.
  assert.deepEqual([0, 250, 500, 750].map(volumeTickLabel), ['0', '250', '500', '750']);
  assert.equal(volumeTickLabel(1000), '1k');
});

test('the digest prints one line per point, never a "•" in the middle of a line', () => {
  assert.equal(
    digestLines('## Week\n- You trained **5** times.\n\n* Sleep held at 7 h.\n• HRV rose.'),
    '- You trained **5** times.\n- Sleep held at 7 h.\n- HRV rose.',
  );
  const lines = digestLines('• One.\n• Two.\n• Three.\n• Four.').split('\n');
  assert.equal(lines.length, 4);
  assert.ok(lines.every((line) => line.startsWith('- ') && !line.slice(2).includes('•')));
  assert.equal(digestLines('One line.'), 'One line.');
  assert.equal(digestLines(''), '');
  // And the view draws each as its own bullet row.
  const blocks = parseMarkdown(digestLines('• One.\n• Two.\n• Three.'));
  assert.deepEqual(blocks.map((block) => block.type), ['bullet', 'bullet', 'bullet']);
});
