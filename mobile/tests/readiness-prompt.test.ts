import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import {
  feelCheckin,
  readinessPrompt,
  respondedToday,
  type ReadinessVerdictData,
} from '../src/features/home/data/readiness-prompt.ts';
import { carriedVsNormal, morningSchema } from '../src/features/health/data/checkin.ts';
import { manualHealthWritePaths } from '../src/features/health/data/manual-write-paths.ts';

const verdict = (
  over: Partial<ReadinessVerdictData> & Pick<ReadinessVerdictData, 'verdict' | 'score'>,
): ReadinessVerdictData => ({
  band: { low: 60.6, high: 80.4 },
  responseState: 'none',
  ...over,
});

test('a usual day states the score and asks nothing', () => {
  const prompt = readinessPrompt(verdict({ verdict: 'normal', score: 72 }));
  assert.deepEqual(prompt, {
    kind: 'usual',
    line: 'Readiness 72 is a usual day for you (usual 61–80).',
  });
});

test('a score under the band asks how the user feels', () => {
  const prompt = readinessPrompt(verdict({ verdict: 'poor', score: 47 }));
  assert.equal(prompt.kind, 'ask');
  if (prompt.kind === 'ask') {
    assert.equal(prompt.eyebrow, 'Readiness is low today');
    assert.equal(prompt.title, '47 is under your usual 61–80. How do you feel?');
  }
});

test('a score over the band asks too', () => {
  const prompt = readinessPrompt(verdict({ verdict: 'good', score: 91.2 }));
  assert.equal(prompt.kind, 'ask');
  if (prompt.kind === 'ask') {
    assert.equal(prompt.eyebrow, 'Readiness is high today');
    assert.match(prompt.title, /^91 is over your usual 61–80/);
  }
});

test('an answered or skipped unusual day goes back to a statement', () => {
  for (const responseState of ['rated', 'dismissed'] as const) {
    const prompt = readinessPrompt(verdict({ verdict: 'poor', score: 47, responseState }));
    assert.deepEqual(prompt, {
      kind: 'usual',
      line: 'Readiness 47 is under your usual 61–80.',
    });
  }
  assert.equal(readinessPrompt(verdict({ verdict: 'poor', score: 47 }), true).kind, 'usual');
});

test('with no verdict the card claims nothing about the score', () => {
  assert.deepEqual(readinessPrompt(null), { kind: 'silent' });
  assert.deepEqual(readinessPrompt(undefined), { kind: 'silent' });
});

test('no wording calls an answer agreement with the score', () => {
  const copy = JSON.stringify([
    readinessPrompt(verdict({ verdict: 'normal', score: 72 })),
    readinessPrompt(verdict({ verdict: 'poor', score: 47 })),
    readinessPrompt(verdict({ verdict: 'poor', score: 47, responseState: 'rated' })),
  ]);
  assert.doesNotMatch(copy, /validat|agree|match|confirm|accurate|correct/i);
});

test('answering keeps what the morning check-in already holds and marks the tap as real', () => {
  const saved = feelCheckin(
    {
      sleepQualityFeel: 2,
      sleepQualityFeelTouched: true,
      soreMuscles: ['Quads'],
      journal: 'slept badly',
      illnessContext: 'sick',
      vsNormal: 'same',
      vsNormalTouched: false,
    },
    'worse',
    2,
  );
  assert.deepEqual(saved, {
    sleepQualityFeel: 2,
    sleepQualityFeelTouched: true,
    phase: 'morning',
    soreMuscles: ['Quads'],
    journal: 'slept badly',
    illnessContext: 'sick',
    vsNormal: 'worse',
    vsQuestion: 2,
    vsNormalTouched: true,
  });
  assert.equal(morningSchema.safeParse(saved).success, true);
  assert.equal(morningSchema.safeParse(feelCheckin(null, 'better', 2)).success, true);
});

test('a queued skip keeps the question away offline, before the verdict reports it', () => {
  assert.equal(respondedToday([{ date: '2026-10-26' }], '2026-10-26'), true);
  assert.equal(respondedToday([{ date: '2026-10-25' }], '2026-10-26'), false);
  const prompt = readinessPrompt(verdict({ verdict: 'poor', score: 47 }), true);
  assert.equal(prompt.kind, 'usual');
});

test('the morning sheet carries a Home answer through its save instead of clearing it', () => {
  const answered = feelCheckin({ sleepQualityFeel: 4 }, 'worse', 1);
  const carried = carriedVsNormal(answered);
  assert.deepEqual(carried, { vsNormal: 'worse', vsQuestion: 1, vsNormalTouched: true });
  // The sheet's save must still validate with the carried fields in it.
  assert.ok(
    morningSchema.safeParse({
      phase: 'morning',
      sleepQualityFeel: 4,
      sleepQualityFeelTouched: false,
      ...carried,
      soreMuscles: [],
    }).success,
  );
  // No answer on file: nothing is invented.
  assert.deepEqual(carriedVsNormal(null), { vsNormal: null, vsNormalTouched: false });
  assert.deepEqual(carriedVsNormal({ vsNormal: 'same' }), {
    vsNormal: 'same',
    vsNormalTouched: false,
  });
});

test('the morning sheet saves through carriedVsNormal, never a cleared answer', async () => {
  // #3334 made the sheet write vsNormal: null on every save, which wiped a Home answer the next
  // time the sheet was saved. The helper is tested above; this pins that the sheet uses it.
  const sheet = await readFile(
    new URL('../src/features/health/components/MorningCheckinSheet.tsx', import.meta.url),
    'utf8',
  );
  assert.match(sheet, /\.\.\.carriedVsNormal\(row\)/);
  assert.doesNotMatch(sheet, /vsNormal:\s*null/);
  assert.doesNotMatch(sheet, /vsNormalTouched:\s*false/);
});

test('an uploaded readiness answer expires the cached verdict, so a skip stays skipped', () => {
  // HealthStore calls back with these paths once the answer's POST lands; a verdict cached from
  // before it still says responseState 'none' and would ask again.
  assert.ok(manualHealthWritePaths.includes('/api/readiness-verdict'));
  assert.ok(manualHealthWritePaths.includes('/api/sleep-verdict'));
});
