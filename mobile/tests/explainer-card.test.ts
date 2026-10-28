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

// #3514: the pure decisions the card renders from. The suite has no React renderer, so the card's
// tree is covered by these and by the source-level checks below, not by a render.
test('a scored, settled factor has a badge, a gauge and the meaning heading', async () => {
  const { explainerShape } = await import('../src/features/health/data/explainer-card.ts');
  assert.deepEqual(explainerShape({ score: 82 }), { badge: true, gauge: 'toward-high', meaningHeading: true });
});

test('a learning factor with a score keeps its heading but not its badge or gauge', async () => {
  const { explainerShape } = await import('../src/features/health/data/explainer-card.ts');
  assert.deepEqual(explainerShape({ score: 64, learning: true }), {
    badge: false,
    gauge: null,
    meaningHeading: true,
  });
});

test('an unscored factor has no badge, gauge or heading, and a middle-is-best gauge still draws', async () => {
  const { explainerShape } = await import('../src/features/health/data/explainer-card.ts');
  assert.deepEqual(explainerShape({ score: null }), { badge: false, gauge: null, meaningHeading: false });
  assert.deepEqual(explainerShape({ score: null, gauge: 50 }), {
    badge: false,
    gauge: 'centered',
    meaningHeading: false,
  });
});

test('the card is accessible and styled as the current app is', async () => {
  const card = await readFile(new URL('../src/features/health/components/ExplainerCard.tsx', import.meta.url), 'utf8');
  assert.match(card, /importantForAccessibility="no-hide-descendants"/, 'TalkBack skips the bullet dot');
  assert.match(card, /variant="subheading" accessibilityRole="header"/, 'the factor name is a header');
  assert.match(card, /variant="explainerFooter"/);
  assert.match(card, /<Field title="Your values" tabular>/);
  assert.match(card, /gap: theme\.spacing\.xs \}\}>\s*<AppText variant="explainerLabel" tone="muted">\s*How to improve it/);
  const contributor = await readFile(
    new URL('../src/features/health/components/ContributorCard.tsx', import.meta.url),
    'utf8',
  );
  assert.match(contributor, /score=\{f\.score \?\? null\}\s*learning=\{f\.learning\}/);
});
