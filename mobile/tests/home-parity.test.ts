import assert from 'node:assert/strict';
import { test } from 'node:test';
import { timelineCardContent } from '../src/features/home/data/timeline-presentation.ts';
import type { TimelineEvent } from '../src/features/home/data/timeline.ts';
import {
  SORE_CHIP_COLOR,
  sessionFacts,
  soreMusclesLabel,
} from '../src/features/home/data/recommendation-presentation.ts';
import { isBandStyle, scoreChipLabel } from '../src/shared/ui/scoreChipStyle.ts';

const event = (over: Partial<TimelineEvent>): TimelineEvent => ({
  type: 'workout',
  time: '7:00 am',
  timeMs: 0,
  title: 'Legs',
  day: 'today',
  ...over,
});

test('only the band styles print the short capital names ("Move", not "Activity")', () => {
  assert.deepEqual(scoreChipLabel('band', 'Activity', 'Move'), { text: 'Move', capitals: true });
  assert.deepEqual(scoreChipLabel('underline', 'Resting HR', 'Rest HR'), {
    text: 'Rest HR',
    capitals: true,
  });
  assert.deepEqual(scoreChipLabel('default', 'Activity', 'Move'), {
    text: 'Activity',
    capitals: false,
  });
  assert.deepEqual(scoreChipLabel('band', 'Activity'), { text: 'Activity', capitals: false });
  assert.equal(isBandStyle(undefined), false);
});

test('a workout card carries "1h 03m", sets and exercises, each singular at one', () => {
  const card = timelineCardContent(event({ durationMin: 63, sets: 1, exerciseCount: 1 }));
  assert.equal(card.title, 'Legs');
  assert.deepEqual(
    card.metrics.map((metric) => metric.text),
    ['1h 03m', '1 set', '1 exercise'],
  );
  assert.deepEqual(
    timelineCardContent(event({ durationMin: 45, sets: 12, exerciseCount: 5 })).metrics.map(
      (metric) => metric.text,
    ),
    ['45m', '12 sets', '5 exercises'],
  );
});

test('the wake-up card puts its time beside the title and tints the two scores', () => {
  const card = timelineCardContent(
    event({
      type: 'wakeup',
      title: 'Woke up',
      sleepDurationH: 7.05,
      readinessScore: 82,
      sleepScore: 77,
    }),
  );
  assert.equal(card.titleTime, true);
  assert.deepEqual(
    card.metrics.map((metric) => [metric.icon, metric.iconTone, metric.text]),
    [
      ['bedDouble', undefined, '7h 03m'],
      ['power', 'success', '82'],
      ['moon', 'sleep', '77'],
    ],
  );
});

test('a run or walk is named as the current app names it, with its distance', () => {
  const run = timelineCardContent(
    event({ type: 'walk', title: 'Run', distanceKm: 5.2, durationMin: 31, calories: 412.4 }),
  );
  assert.equal(run.title, 'Outdoor running / 5.2 km');
  assert.deepEqual(
    run.metrics.map((metric) => metric.text),
    ['31m', '412 kcal'],
  );
  assert.equal(
    timelineCardContent(event({ type: 'walk', title: 'Walk' })).title,
    'Outdoor walking',
  );
});

test('a meal card splits the route\'s "kcal · window" subtitle, and drops the local marker', () => {
  const routed = timelineCardContent(
    event({ type: 'meal', title: '🍳 Breakfast', subtitle: '456 kcal · 6 AM – 9 AM' }),
  );
  assert.equal(routed.title, 'Breakfast');
  assert.deepEqual(
    routed.metrics.map((metric) => [metric.icon, metric.text]),
    [
      ['flame', '456 kcal'],
      [undefined, '6 AM – 9 AM'],
    ],
  );
  const local = timelineCardContent(
    event({ type: 'meal', title: 'Lunch', calories: 640, subtitle: 'Saved on this phone' }),
  );
  assert.deepEqual(
    local.metrics.map((metric) => metric.text),
    ['640 kcal'],
  );
});

test('bedtime says only its title; sleep and tag add their one line', () => {
  assert.deepEqual(timelineCardContent(event({ type: 'bedtime', title: 'Bedtime' })).metrics, []);
  assert.deepEqual(
    timelineCardContent(event({ type: 'sleep', title: 'Fell asleep', subtitle: '12 min latency' }))
      .metrics,
    [{ icon: 'history', text: '12 min latency' }],
  );
  assert.deepEqual(
    timelineCardContent(event({ type: 'tag', title: 'Sauna', subtitle: 'Evening' })).metrics,
    [{ text: 'Evening' }],
  );
});

test('the session facts line leaves the length out when the session has none', () => {
  const facts = sessionFacts(
    { durationMinutes: 52.4, exercises: new Array(6), lastTrained: '2026-10-20' },
    '2026-10-23',
  );
  assert.deepEqual(
    facts.map((fact) => [fact.icon, fact.text.startsWith('Last: ') ? 'last' : fact.text]),
    [
      ['history', '~52 min'],
      ['workout', '6 exercises'],
      ['calendarPlain', 'last'],
    ],
  );
  const bare = sessionFacts(
    { durationMinutes: null, exercises: [], lastTrained: null },
    '2026-10-23',
  );
  assert.deepEqual(
    bare.map((fact) => fact.text),
    ['0 exercises', 'Last: —'],
  );
  assert.equal(
    sessionFacts(
      { durationMinutes: null, exercises: [], lastTrained: '2026-10-23' },
      '2026-10-23',
    )[1].text,
    'Last: Today',
  );
});

test('the soreness chip names the muscles in the order given', () => {
  assert.equal(soreMusclesLabel(['Quads', 'Glutes']), 'Quads, Glutes');
  assert.equal(soreMusclesLabel([]), '');
  assert.match(SORE_CHIP_COLOR, /^#[0-9a-f]{6}$/);
});
