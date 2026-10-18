import assert from 'node:assert/strict';
import { test } from 'node:test';
import { contributorFactors } from '../src/features/health/data/contributor-factors.ts';
import { contributorNote, OURA_CONTRIBUTOR_NOTE } from '@trainingai/shared/health/score-gap-copy';

// #3029: a provisional factor with a real score shows it; only learning or empty ones are unscored.
const weights = { hrvBalance: 0.3, recoveryIndex: 0.1, temperature: 0.2, sleepBalance: 0.4 };
const contributors = { hrvBalance: 50, recoveryIndex: 72, temperature: 50, sleepBalance: 40 };
const factors = contributorFactors({
  contributors,
  weights,
  provisional: ['hrvBalance', 'recoveryIndex', 'temperature'],
  cases: {
    hrvBalance: { gap: 'awaiting_baseline' },
    recoveryIndex: { gap: null, scale: 'oura_contributor' },
    temperature: { gap: 'no_input' },
    sleepBalance: { gap: null },
  },
});
const byKey = Object.fromEntries(factors.map((f) => [f.key, f]));

test('an Oura-contributor factor is not learning, keeps its score and its own note', () => {
  assert.equal(byKey.recoveryIndex.learning, false);
  assert.equal(byKey.recoveryIndex.score, 72);
  assert.equal(contributorNote(byKey.recoveryIndex), OURA_CONTRIBUTOR_NOTE);
});

test('learning and empty factors stay unscored', () => {
  assert.equal(byKey.hrvBalance.learning, true);
  assert.equal(byKey.temperature.learning, true);
});

test('scored factors sort worst first and learning ones go last by weight', () => {
  assert.deepEqual(
    factors.map((f) => f.key),
    ['sleepBalance', 'recoveryIndex', 'hrvBalance', 'temperature'],
  );
});

test('a payload without gap keeps provisional as learning', () => {
  const [f] = contributorFactors({ contributors: { hrvBalance: 50 }, weights: { hrvBalance: 1 }, provisional: ['hrvBalance'] });
  assert.equal(f.learning, true);
});

test('a factor with no score is learning', () => {
  const [f] = contributorFactors({ contributors: { hrvBalance: null }, weights: { hrvBalance: 1 } });
  assert.equal(f.learning, true);
});
