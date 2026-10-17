import assert from 'node:assert/strict';
import { test } from 'node:test';
import { computeBarMetric } from '@trainingai/shared/health/strength-progress';
import {
  goalCountText,
  lastTrainedSession,
  strengthDelta,
  strengthFillPct,
  strengthGroups,
} from '../src/features/health/progressPresentation';
import { createTheme } from '../src/shared/theme/theme';
import { trainingColors } from '../src/shared/theme/tokens';

const colors = { trendUp: 'UP', trendDown: 'DOWN' };

const base = {
  estimated1rm: 100,
  previousEstimated1rm: 90,
  personalRecord1rm: 100,
  weight: 80,
  exerciseType: 'weighted' as const,
  lastReps: null,
  maxReps: null,
};

test('a loaded exercise reads its delta in kg, in the better or worse colour', () => {
  const up = strengthDelta(computeBarMetric(base, 'latest')!, colors);
  assert.deepEqual(up, { text: '+10 kg', color: 'UP' });
  const down = strengthDelta(computeBarMetric({ ...base, previousEstimated1rm: 110 }, 'latest')!, colors);
  assert.deepEqual(down, { text: '-10 kg', color: 'DOWN' });
});

test('a rep exercise reads its delta in reps, never RM', () => {
  const metric = { pct: 80, label: '10 reps', color: '#bf5fff', deltaUnit: 'RM' as const };
  assert.deepEqual(strengthDelta({ ...metric, trend: 'up', delta: 3 }, colors), {
    text: '+3 reps',
    color: 'UP',
  });
  assert.equal(strengthDelta({ ...metric, trend: 'down', delta: 1 }, colors)?.text, '-1 rep');
});

test('no delta is shown when nothing changed or there is no previous reading', () => {
  const same = computeBarMetric({ ...base, previousEstimated1rm: 100 }, 'latest')!;
  assert.equal(strengthDelta(same, colors), null);
  assert.equal(strengthDelta(computeBarMetric({ ...base, previousEstimated1rm: null }, 'latest')!, colors), null);
});

test('strength groups skip exercises without a 1RM and sessions left with no row', () => {
  const lift = (exercise: string, sessionName: string, extra = {}) => ({
    ...base,
    exercise,
    sessionName,
    ...extra,
  });
  const exercises = [
    lift('Squat', 'Legs', { estimated1rm: null, weight: 100 }),
    lift('Bench', 'Push'),
    lift('Press', 'Push', { weight: null }),
    lift('Row', 'Pull', { weight: null }),
  ];
  assert.deepEqual(
    strengthGroups(exercises, 'working').map((g) => [g.session, g.rows.map((r) => r.exercise.exercise)]),
    [['Push', ['Bench']]],
  );
  assert.deepEqual(
    strengthGroups(exercises, 'latest').map((g) => [g.session, g.rows.map((r) => r.exercise.exercise)]),
    [
      ['Push', ['Bench', 'Press']],
      ['Pull', ['Row']],
    ],
  );
  assert.deepEqual(strengthGroups([], 'latest'), []);
});

test('the last trained session is the one with the newest dated reading', () => {
  assert.equal(
    lastTrainedSession([
      { sessionName: 'Pull', date: '2026-10-10', estimated1rm: 80 },
      { sessionName: 'Push', date: '2026-10-14', estimated1rm: 90 },
      { sessionName: 'Legs', date: '2026-10-16', estimated1rm: null },
      { sessionName: 'Upper', date: null, estimated1rm: 70 },
    ]),
    'Push',
  );
  assert.equal(lastTrainedSession([]), null);
});

test('a low strength fill keeps a visible sliver', () => {
  assert.equal(strengthFillPct(1), 4);
  assert.equal(strengthFillPct(72), 72);
});

test('goal counts group digits and tick when met', () => {
  assert.equal(goalCountText(3200, 8000, false), '3,200 / 8,000');
  assert.equal(goalCountText(8000, 8000, false), '8,000 / 8,000 ✓');
  assert.equal(goalCountText(1, 1, false), '1 / 1 ✓');
  assert.equal(goalCountText(2, 4, true), 'This week: 2 / 4');
});

test('a goal ticks only when the raw value reaches it, as the current app does', () => {
  assert.equal(goalCountText(7.96, 8, false), '8 / 8');
  assert.equal(goalCountText(7.9, 8, false), '7.9 / 8');
});

function luminance(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [16, 8, 0].map((shift) => {
    const v = ((n >> shift) & 255) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
/** `#rrggbbaa` painted over an opaque `#rrggbb`. */
function over(fg: string, bg: string) {
  const alpha = parseInt(fg.slice(7, 9), 16) / 255;
  const mix = (shift: number) =>
    Math.round(((parseInt(fg.slice(1, 7), 16) >> shift) & 255) * alpha + ((parseInt(bg.slice(1), 16) >> shift) & 255) * (1 - alpha));
  return `#${[16, 8, 0].map((s) => mix(s).toString(16).padStart(2, '0')).join('')}`;
}
function contrast(a: string, b: string) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

test('progress and training colours stay readable on the card in both themes', () => {
  for (const mode of ['light', 'dark'] as const) {
    const theme = createTheme(mode, 'green');
    const texts = [
      theme.progress.strength,
      theme.progress.trendUp,
      theme.progress.trendDown,
      ...Object.values(theme.progress.goals),
      theme.training.activity,
      theme.training.movement,
      ...Object.values(theme.training.phases),
    ];
    for (const color of texts) {
      assert.ok(contrast(color, theme.colors.surface) >= 4.5, `${mode} ${color}`);
    }
    // The Strength card tints itself `${accent}18` over the screen, which is darker than the surface.
    const tinted = over(`${theme.progress.strength}18`, theme.colors.surface);
    for (const color of [theme.progress.trendUp, theme.progress.trendDown, theme.progress.strength]) {
      assert.ok(contrast(color, tinted) >= 4.5, `${mode} ${color} on the tinted Strength card`);
    }
  }
});

test('phases keep their own colours whatever the session palette holds', () => {
  const reordered = createTheme('dark', 'green', {
    sessions: createTheme('dark', 'green').sessions.slice().reverse(),
  });
  assert.deepEqual(reordered.training.phases, createTheme('dark', 'green').training.phases);
  assert.equal(reordered.training.phases.baseline, reordered.colors.muted);
  assert.deepEqual(Object.keys(trainingColors.dark.phases), [
    'accumulation',
    'intensification',
    'realisation',
    'deload',
  ]);
});
