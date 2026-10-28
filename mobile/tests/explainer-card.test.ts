import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { BULLET_GLYPH, bulletLayout, explainerBadge } from '../src/features/health/data/explainer-card.ts';
import { statusColors } from '../src/shared/theme/tokens.ts';

// #3507: the explainer cards draw the factor badge and the bullet list as the current app does.
for (const mode of ['dark', 'light'] as const) {
  const status = statusColors[mode];
  test(`the badge is bold coloured text by band (${mode})`, () => {
    assert.deepEqual(explainerBadge(82, status), { text: 'High · 82', color: status.success });
    assert.deepEqual(explainerBadge(70, status), { text: 'High · 70', color: status.success });
    assert.deepEqual(explainerBadge(50, status), { text: 'Moderate · 50', color: status.warning });
    assert.deepEqual(explainerBadge(37, status), { text: 'Low · 37', color: status.danger });
  });
}

test('an unscored factor has no badge', () => {
  assert.equal(explainerBadge(null, statusColors.dark), null);
  assert.equal(explainerBadge(undefined, statusColors.dark), null);
});

test('a bullet hangs: the dot has its own column and the text takes the rest', async () => {
  const layout = bulletLayout(16);
  assert.equal(layout.row.flexDirection, 'row');
  assert.equal(layout.row.alignItems, 'flex-start');
  assert.equal(layout.dot.width, 16);
  assert.equal(layout.text.flex, 1, 'a wrapped line stays inside the text column, under the first word');
  assert.equal(BULLET_GLYPH, '•');
  const card = await readFile(new URL('../src/features/health/components/ExplainerCard.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(card, /•\s*\{/, 'no inline bullet glyph in the text');
  assert.match(card, /bulletLayout\(/);
});

test('Sleep, Readiness and Heart rate share one explainer card', async () => {
  const contributor = await readFile(
    new URL('../src/features/health/components/ContributorCard.tsx', import.meta.url),
    'utf8',
  );
  assert.match(contributor, /<ExplainerCard/);
  assert.doesNotMatch(contributor, /What it measures/, 'the sub-headings live only in ExplainerCard');
});
