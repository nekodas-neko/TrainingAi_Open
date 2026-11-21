import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import {
  feelCheckin,
  readinessCardLine,
  readinessPrompt,
  readinessQuestionDismissKey,
  unusualDayCard,
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

// #3659: the verdict is frozen at the first read of the day; today can be re-scored later. While
// the question is unanswered the wording is decided again from the live score against the verdict's
// own band; once answered, the sentence keeps the frozen score and direction together.
const band = { low: 57, high: 70 };
const frozenGood = verdict({ verdict: 'good', score: 78, band });
const frozenPoor = verdict({ verdict: 'poor', score: 48, band });

test('unanswered: a live score back inside the band is a usual day and nothing is asked', () => {
  const prompt = readinessPrompt(frozenGood, false, 62);
  assert.deepEqual(prompt, {
    kind: 'usual',
    line: 'Readiness 62 is a usual day for you (usual 57–70).',
  });
  assert.equal(unusualDayCard(prompt, false), null);
});

test('unanswered: a live score still outside on the same side asks, with the live score', () => {
  const prompt = readinessPrompt(frozenGood, false, 74.4);
  assert.equal(prompt.kind, 'ask');
  if (prompt.kind === 'ask') {
    assert.equal(prompt.eyebrow, 'Readiness is high today');
    assert.equal(prompt.title, '74 is over your usual 57–70. How do you feel?');
  }
  assert.ok(unusualDayCard(prompt, false));
});

test('unanswered: a live score across the band asks with the other wording', () => {
  const prompt = readinessPrompt(frozenGood, false, 50);
  assert.equal(prompt.kind, 'ask');
  if (prompt.kind === 'ask') {
    assert.equal(prompt.eyebrow, 'Readiness is low today');
    assert.equal(prompt.title, '50 is under your usual 57–70. How do you feel?');
  }
  const usualFrozen = readinessPrompt(verdict({ verdict: 'normal', score: 61, band }), false, 75);
  assert.equal(usualFrozen.kind, 'ask');
});

test('unanswered: the band edges are usual, as the shared rule has it', () => {
  assert.equal(readinessPrompt(frozenGood, false, 57).kind, 'usual');
  assert.equal(readinessPrompt(frozenGood, false, 70).kind, 'usual');
});

test('answered or skipped: the frozen score and direction stand whatever the live score is', () => {
  for (const live of [62, 50, 90, null, undefined]) {
    assert.deepEqual(readinessPrompt({ ...frozenGood, responseState: 'rated' }, false, live), {
      kind: 'usual',
      line: 'Readiness 78 is over your usual 57–70.',
    });
    assert.deepEqual(readinessPrompt(frozenPoor, true, live), {
      kind: 'usual',
      line: 'Readiness 48 is under your usual 57–70.',
    });
  }
  assert.deepEqual(readinessPrompt(verdict({ verdict: 'normal', score: 61, band, responseState: 'dismissed' }), false, 75), {
    kind: 'usual',
    line: 'Readiness 61 is a usual day for you (usual 57–70).',
  });
});

test('no live score yet: the verdict’s own score and direction stand', () => {
  for (const live of [undefined, null]) {
    assert.deepEqual(readinessPrompt(verdict({ verdict: 'normal', score: 72 }), false, live), {
      kind: 'usual',
      line: 'Readiness 72 is a usual day for you (usual 61–80).',
    });
    const asked = readinessPrompt(frozenGood, false, live);
    assert.equal(asked.kind, 'ask');
    if (asked.kind === 'ask') {
      assert.equal(asked.title, '78 is over your usual 57–70. How do you feel?');
    }
  }
});

test('a sentence never states a score inside its own range as under or over it', () => {
  for (let live = 40; live <= 95; live += 0.5) {
    for (const answered of [false, true]) {
      const prompt = readinessPrompt(frozenGood, answered, live);
      if (prompt.kind === 'silent') continue;
      const m = prompt.line.match(/Readiness (\d+) is (under|over)/);
      if (!m) continue;
      const shown = Number(m[1]);
      assert.ok(m[2] === 'under' ? shown < 57 : shown > 70, `${live} ${answered}: ${prompt.line}`);
    }
  }
});

test('Home’s readiness question passes the live score the chips show', async () => {
  const card = await readFile(
    new URL('../src/features/home/data/useReadinessQuestion.ts', import.meta.url),
    'utf8',
  );
  assert.match(card, /useWorkoutResource\(readinessSpec\(health\.today\)\)/);
  assert.match(card, /readiness\.data\?\.readinessDisplayScore,\s*\);/);
});

// #3953: the question has its own card, whatever Home cards are switched on.
const unusual = (feelAnswered = false, responseState: ReadinessVerdictData['responseState'] = 'none') =>
  readinessPrompt(verdict({ verdict: 'poor', score: 47, responseState }), feelAnswered);

test('the unusual-day card shows on an unusual day, with no card preference involved', () => {
  const card = unusualDayCard(unusual(), false);
  assert.equal(card?.title, '47 is under your usual 61–80. How do you feel?');
  assert.equal(unusualDayCard.length, 2, 'it takes the prompt and the dismissal, nothing else');
});

test('the unusual-day card is hidden on a usual or unscored day', () => {
  assert.equal(unusualDayCard(readinessPrompt(verdict({ verdict: 'normal', score: 72 })), false), null);
  assert.equal(unusualDayCard(readinessPrompt(null), false), null);
});

test('the unusual-day card is hidden once answered, here or on a queued/stored response', () => {
  assert.equal(unusualDayCard(unusual(true), false), null);
  assert.equal(unusualDayCard(unusual(false, 'rated'), false), null);
  assert.equal(unusualDayCard(unusual(false, 'dismissed'), false), null);
});

test('a dismissal hides the card for that local day only, and is back tomorrow', () => {
  const markers: Record<string, boolean> = { [readinessQuestionDismissKey('2026-11-21')]: true };
  const dismissed = (day: string) => !!markers[readinessQuestionDismissKey(day)];
  assert.equal(unusualDayCard(unusual(), dismissed('2026-11-21')), null);
  assert.ok(unusualDayCard(unusual(), dismissed('2026-11-22')));
});

test('the question is never asked twice: the Exercise Readiness card only states the score', async () => {
  assert.equal(readinessCardLine(unusual()), 'Readiness 47 is under your usual 61–80.');
  assert.equal(readinessCardLine(readinessPrompt(null)), null);
  const card = await readFile(
    new URL('../src/features/home/components/ReadinessPromptCard.tsx', import.meta.url),
    'utf8',
  );
  assert.doesNotMatch(card, /FEEL_OPTIONS|How do you feel|respondToReadiness/);
});

test('the unusual-day card is mounted once, outside the switchable Home sections', async () => {
  const screen = await readFile(
    new URL('../src/features/home/screens/HomeScreen.tsx', import.meta.url),
    'utf8',
  );
  assert.equal(screen.match(/<UnusualDayCard \/>/g)?.length, 1);
  assert.ok(screen.indexOf('<UnusualDayCard />') < screen.indexOf('<SortableStack'));
});

test('a dismissal writes a local marker and nothing to the server; an answer uses the existing path', async () => {
  const hook = await readFile(
    new URL('../src/features/home/data/useReadinessQuestion.ts', import.meta.url),
    'utf8',
  );
  const dismiss = hook.slice(hook.indexOf('async function dismiss'));
  assert.match(dismiss, /home\.store\.mark\(readinessQuestionDismissKey/);
  assert.doesNotMatch(dismiss, /respondToReadiness|saveCheckin/);
  assert.match(hook, /respondToReadiness\(health\.today, 'rated'\)/);
});
