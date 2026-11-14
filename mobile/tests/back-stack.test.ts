import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import {
  MAX_DEPTH,
  initialNavigation,
  openOnTab,
  pop,
  push,
  replaceTop,
  rootBack,
  selectTab,
  top,
  type Navigation,
  type Route,
} from '../src/app/navigation/stack.ts';

// #3754. Back returns to the screen you came from. These walk the stack the way App.tsx does:
// opening a screen pushes, Back pops, choosing a tab clears.

const on = (tab: Navigation['tab']) => selectTab(initialNavigation, tab);
const walk = (nav: Navigation, ...routes: Route[]) => routes.reduce(push, nav);
/** What is showing: the top screen, or the tab with nothing open. */
const showing = (nav: Navigation) => top(nav)?.screen ?? nav.tab;
const screens = (nav: Navigation) => nav.stack.map((entry) => entry.screen);

test('push opens a screen and pop returns to the one under it', () => {
  let nav = walk(on('Workout'), { screen: 'cardio' }, { screen: 'running' });
  assert.deepEqual(screens(nav), ['cardio', 'running']);
  nav = pop(nav);
  assert.equal(showing(nav), 'cardio');
  nav = pop(nav);
  assert.equal(showing(nav), 'Workout');
  assert.equal(pop(nav), nav, 'Back with nothing open changes nothing');
});

test('a covered screen keeps its key, so it is the same mounted screen on return', () => {
  const nav = walk(on('More'), { screen: 'more-devices' });
  const devices = top(nav)!.key;
  const back = pop(push(nav, { screen: 'more-signed-in-devices' }));
  assert.equal(top(back)!.key, devices);
  // A later visit is a new screen.
  assert.notEqual(top(push(pop(back), { screen: 'more-devices' }))!.key, devices);
});

test('choosing a tab clears the stack', () => {
  const nav = selectTab(walk(on('Workout'), { screen: 'cardio' }, { screen: 'running' }), 'Health');
  assert.equal(nav.tab, 'Health');
  assert.deepEqual(nav.stack, []);
});

for (const from of ['running', 'guided-walk', 'fitness-baselines'] as const) {
  test(`the activity recorder opened from ${from} returns to it, not to Cardio`, () => {
    const nav = walk(on('Workout'), { screen: 'cardio' }, { screen: from }, { screen: 'activity-recording' });
    assert.equal(showing(pop(nav)), from);
    assert.equal(showing(pop(pop(nav))), 'cardio');
  });
}

test('Profile details opened from Goals returns to Goals', () => {
  const nav = walk(on('More'), { screen: 'profile-goals' }, { screen: 'profile-details' });
  assert.equal(showing(pop(nav)), 'profile-goals');
});

test('Settings opened from another tab or from a screen returns there', () => {
  for (const tab of ['Health', 'Workout', 'Nutrition'] as const) {
    const nav = push(on(tab), { screen: 'settings' });
    assert.equal(nav.tab, tab, 'opening Settings no longer moves to More');
    assert.equal(showing(pop(nav)), tab);
  }
  const cardio = walk(on('Workout'), { screen: 'cardio' }, { screen: 'settings' });
  assert.equal(showing(pop(cardio)), 'cardio');
  const session = walk(
    on('Home'),
    { screen: 'workout-session', sessionId: 's1', fullOverride: false },
    { screen: 'settings' },
  );
  assert.equal(showing(pop(session)), 'workout-session');
});

test('a session or a workout opened from Home returns to Home', () => {
  const session = push(on('Home'), { screen: 'workout-session', sessionId: 's1', fullOverride: false });
  assert.equal(session.tab, 'Home');
  assert.equal(showing(pop(session)), 'Home');
  const workout = push(on('Home'), { screen: 'workout-log', workoutId: 'w1' });
  assert.equal(showing(pop(workout)), 'Home');
});

test('starting a workout replaces its session, so closing it returns to where the session was opened', () => {
  const session = push(on('Home'), { screen: 'workout-session', sessionId: 's1', fullOverride: false });
  const workout = replaceTop(session, { screen: 'workout-log', workoutId: 'w1' });
  assert.deepEqual(screens(workout), ['workout-log']);
  assert.equal(showing(pop(workout)), 'Home');
});

test('the screens that used to restart are still under the one opened from them', () => {
  const programs = walk(on('Workout'), { screen: 'programs' }, { screen: 'program-builder' });
  assert.deepEqual(screens(programs), ['programs', 'program-builder']);
  const profile = walk(on('More'), { screen: 'profile-details' }, { screen: 'clinical' });
  assert.equal(showing(pop(profile)), 'profile-details');
  const baselines = walk(on('More'), { screen: 'profile-details' }, { screen: 'fitness-baselines' });
  assert.equal(showing(pop(baselines)), 'profile-details');
  // DEXA and RMR opened straight from More still returns to More.
  assert.equal(showing(pop(push(on('More'), { screen: 'clinical' }))), 'More');
});

test('the Coach hand-off returns to the Coach, then to where the Coach was opened', () => {
  const coach = walk(
    on('Workout'),
    { screen: 'workout-log', workoutId: 'w1' },
    { screen: 'coach', scope: 'general' },
  );
  const programs = walk(coach, { screen: 'programs' }, { screen: 'program-builder' });
  assert.equal(showing(pop(programs)), 'programs');
  assert.equal(showing(pop(pop(programs))), 'coach');
  const recorder = push(coach, { screen: 'activity-recording' });
  assert.equal(showing(pop(recorder)), 'coach');
  assert.equal(showing(pop(pop(recorder))), 'workout-log');
  assert.equal(showing(pop(pop(pop(recorder)))), 'Workout');
});

test('a notification or a widget opens its screen on its tab, and Back lands on that tab', () => {
  const deep = walk(on('More'), { screen: 'profile-goals' }, { screen: 'profile-details' });
  const cases: [Navigation['tab'], Route][] = [
    ['Workout', { screen: 'workout-log', workoutId: 'w1' }],
    ['Workout', { screen: 'workout-session', sessionId: 's1', fullOverride: false }],
    ['Workout', { screen: 'activity-recording' }],
    ['Health', { screen: 'health-detail', detail: 'readiness' }],
    ['Health', { screen: 'health-week', week: '2026-11-02' }],
    ['More', { screen: 'more-devices', ouraReturn: 'trainingai://oura?code=1' }],
  ];
  for (const [tab, route] of cases) {
    const nav = openOnTab(deep, tab, route);
    assert.equal(nav.tab, tab);
    assert.deepEqual(screens(nav), [route.screen]);
    assert.equal(showing(pop(nav)), tab);
  }
});

test('opening a screen that is already open returns to it instead of stacking a second one', () => {
  const coach: Route = { screen: 'coach', scope: 'general' };
  const nav = walk(on('Home'), coach, { screen: 'programs' });
  assert.deepEqual(screens(push(nav, coach)), ['coach']);
  assert.equal(push(nav, { screen: 'programs' }), nav, 'a double tap opens it once');
  // The same screen with other contents is another screen.
  const days = walk(on('Health'), { screen: 'health-day', date: '2026-11-01' }, { screen: 'health-day', date: '2026-11-02' });
  assert.equal(days.stack.length, 2);
});

test('past the depth cap the oldest screen is dropped and Back still ends on the tab', () => {
  let nav = on('Health');
  for (let day = 1; day <= MAX_DEPTH + 3; day++) {
    nav = push(nav, { screen: 'health-day', date: `2026-10-${String(day).padStart(2, '0')}` });
  }
  assert.equal(nav.stack.length, MAX_DEPTH);
  assert.deepEqual(nav.stack[0], { screen: 'health-day', date: '2026-10-04', key: 4 });
  for (let step = 0; step < MAX_DEPTH; step++) nav = pop(nav);
  assert.equal(showing(nav), 'Health');
});

test("Android Back with nothing open goes Home from another tab, and leaves the app from Home", () => {
  assert.equal(rootBack(on('Home')), 'exit');
  for (const tab of ['Health', 'Workout', 'Nutrition', 'More'] as const) {
    assert.equal(rootBack(on(tab)), 'home');
  }
  assert.equal(rootBack(push(on('Home'), { screen: 'settings' })), 'screen');
});

test('App.tsx routes Back through the stack and registers the app-level handler only with nothing open', async () => {
  const app = await readFile(new URL('../src/app/App.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(app, /coachReturn|coachHandoff|profileReturn|setDetail\(|setHealthDetail\(/);
  // Every onBack is "pop": none names a destination.
  for (const [, handler] of app.matchAll(/\b(?:onBack|closeSession|closeWorkout)=\{([^}]*)\}/g)) {
    assert.equal(handler, 'back');
  }
  assert.match(app, /useAndroidBack\(\s*!tooOld && stack\.rootBack\(nav\) === 'home' \?/);
  assert.match(app, /<TabBar selected=\{tab\} onSelect=\{pressTab\} \/>/);
});
