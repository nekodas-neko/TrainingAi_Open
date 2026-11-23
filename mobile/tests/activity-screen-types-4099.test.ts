import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { test } from 'node:test';
import { createElement, type ReactElement } from 'react';

// #4099: every activity the Log Activity sheet offers, opened on the activity screen in its first
// state (just chosen, not started) and then recording and done. The server's eleven types, as the
// `activity_types` table holds them. Rendered with react-dom/server against stand-ins for the native
// layer, so this shows the screen draws for each type, not how it looks on the phone.
const screen = new URL('../src/features/activities/screens/ActivityScreen.tsx', import.meta.url).href;
const stubs = new URL('./fixtures/activity-screen-stubs.ts', import.meta.url).href;
const stubbed = new Set([
  'react-native',
  '../../../shared/ui',
  '../../../shared/theme/ThemeProvider',
  '../../../shared/hooks/useClock',
  '../data/ActivityProvider',
  '../data/ActivityStore',
  '../data/useRouteRecording',
  '../data/hr-window',
  '../../health/data/HealthDataProvider',
  '../../workouts/data/WorkoutDataProvider',
  '../../health/data/models',
  '../../platform/useTrainingKeepAwake',
  '../../../core/reporting/index.ts',
  '../../devices/strap/StrapProvider',
  '../../devices/strap/labels',
  '../components/LiveStrapBpm',
  '../components/RouteMap',
  './GuidedActivityScreen',
]);
registerHooks({
  resolve(specifier, context, next) {
    if (context.parentURL === screen && stubbed.has(specifier)) return { url: stubs, shortCircuit: true };
    return next(specifier, context);
  },
});
const server = 'react-dom/server';
const { renderToStaticMarkup } = (await import(server)) as {
  renderToStaticMarkup: (element: ReactElement) => string;
};
const { ActivityScreen } = await import(screen);
const { current } = await import('./fixtures/activity-screen-stubs.ts');
const { activityIcon } = await import('../src/features/activities/data/models.ts');

const TYPES = [
  ['walk', 'Walk', 'PersonSimpleWalk', true],
  ['run', 'Run', 'PersonSimpleRun', true],
  ['cycle', 'Cycle', 'PersonSimpleBike', true],
  ['hike', 'Hike', 'PersonSimpleHike', true],
  ['swim', 'Swim', 'PersonSimpleSwim', true],
  ['yoga', 'Yoga', 'PersonSimpleTaiChi', false],
  ['stretch', 'Stretching', 'PersonSimple', false],
  ['hiit', 'HIIT', 'Lightning', false],
  ['other', 'Other', 'DotsThreeCircle', false],
  ['treadmill', 'Treadmill', 'PersonSimpleWalk', false],
  ['strength', 'Strength', 'Barbell', false],
] as const;
const ICONS = ['legs', 'bike', 'waves', 'mountain', 'workout', 'cardio', 'power', 'activity'];

function session(
  [id, label, icon, isDistanceBased]: readonly [string, string, string, boolean],
  mode: 'pre' | 'active' | 'done',
  extra: Record<string, unknown> = {},
) {
  return {
    id: `s-${id}`,
    type: { id, label, icon, isDistanceBased },
    title: label,
    mode,
    startMs: mode === 'pre' ? null : 1_000,
    endMs: mode === 'done' ? 61_000 : null,
    pausedMs: 0,
    pauseStartMs: null,
    notes: '',
    distance: '',
    ...extra,
  };
}
const render = (value: unknown) => {
  current.session = value;
  return renderToStaticMarkup(createElement(ActivityScreen, { onBack() {}, onSaved() {} }));
};

test('the activity types are the eleven the sheet offers', () => {
  assert.equal(TYPES.length, 11);
  assert.deepEqual(
    TYPES.map(([, label]) => label).sort(),
    ['Cycle', 'HIIT', 'Hike', 'Other', 'Run', 'Strength', 'Stretching', 'Swim', 'Treadmill', 'Walk', 'Yoga'],
  );
});

for (const type of TYPES) {
  test(`${type[1]}: the chosen activity draws, with the type's title and an icon that exists`, () => {
    const html = render(session(type, 'pre'));
    assert.match(html, new RegExp(`aria-label="${type[1]}"`));
    const drawn = html.match(/data-name="(\w+)"/)?.[1];
    assert.equal(drawn, activityIcon(type[2]));
    assert.ok(ICONS.includes(drawn!), `${drawn} is an icon the app draws`);
    assert.match(html, /Start/);
  });
  test(`${type[1]}: recording draws with no fix, pace or distance yet`, () => {
    const html = render(session(type, 'active'));
    assert.match(html, new RegExp(`aria-label="${type[1]}"`));
    assert.match(html, /Pause/);
    assert.match(html, /Finish/);
  });
  test(`${type[1]}: the finished activity draws with nothing recorded`, () => {
    const html = render(session(type, 'done'));
    assert.match(html, /aria-label="Activity complete"/);
    assert.match(html, /Duration/);
  });
}

test('a type the app has no icon for draws the fallback, and an empty name does not throw', () => {
  assert.equal(activityIcon('SomethingNew'), 'activity');
  assert.equal(activityIcon(''), 'activity');
  const html = render(session(['x', '', 'SomethingNew', false], 'pre'));
  assert.match(html, /data-name="activity"/);
});

test('no session: the screen says so instead of throwing', () => {
  assert.match(render(null), /No activity in progress/);
});
